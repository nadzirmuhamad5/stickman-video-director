import fs from "node:fs";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import {
  buildSrt,
  buildScenePrompt,
  jobDir,
  probeDuration,
  readJob,
  readProgress,
  runFfmpeg,
  sleep,
  writeProgress,
  type ProposalClip,
  type ProductionJob,
} from "@/lib/production";
import { synthesizeTTS } from "@/lib/tts";
import { resolveVoice } from "@/lib/tts-voices";
import {
  buildClipCanvasProject,
  runCanvasRender,
  type CanvasCue,
} from "@/lib/canvas-project";
import {
  recordJobDone,
  recordJobError,
  recordJobStage,
  recordJobStart,
} from "@/lib/production-db";

// ---------------------------------------------------------------------------
// Server-driven production runner (Mode A · Director). The whole pipeline
// (image + TTS per clip, canvas-rendered animated segments, concat) runs in
// the background on the server, so a closed or refreshed browser tab can no
// longer abort production. The client polls /api/production/status/[jobId].
// ---------------------------------------------------------------------------

export type RenderResult = {
  duration: number;
  videoUrl: string;
  posterUrl: string;
  srtUrl: string;
};

const running = new Set<string>();

// In-memory Sets are unreliable across route bundles (Next.js compiles each
// route separately) and die with the process. A lock file holding the runner's
// PID survives both: same process => alive check; after a restart the old PID
// is dead, so the job correctly reports "not running" and can be resumed.
export const jobLockPath = (jobId: string) => path.join(jobDir(jobId), "running.lock");

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === "EPERM"; // hidup tapi tanpa izin sinyal
  }
}

export function isJobRunning(jobId: string): boolean {
  if (running.has(jobId)) return true;
  try {
    const raw = JSON.parse(fs.readFileSync(jobLockPath(jobId), "utf8")) as { pid?: number };
    return typeof raw.pid === "number" && pidAlive(raw.pid);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ image ---

async function generateClipImage(job: ProductionJob, clip: ProposalClip, imagePath: string): Promise<void> {
  const scenePrompt = buildScenePrompt(job.proposal, clip);
  let lastError = "Unknown image error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const zai = await ZAI.create();
      const response = await zai.images.generations.create({
        prompt: scenePrompt,
        size: job.proposal.ratio === "9:16" ? "720x1440" : "1344x768",
      });
      const base64 = response.data?.[0]?.base64;
      if (!base64) throw new Error("Respons image generation kosong");
      fs.writeFileSync(imagePath, Buffer.from(base64, "base64"));
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[production-runner] image klip ${clip.index} attempt ${attempt}/3 gagal: ${lastError}`);
      await sleep(900 * attempt);
    }
  }
  throw new Error(`Gagal membuat ilustrasi klip ${clip.index}: ${lastError}`);
}

// -------------------------------------------------------------------- tts ---

async function generateClipAudio(job: ProductionJob, clip: ProposalClip, audioPath: string): Promise<number> {
  const narration = (job.narrationLang === "en" ? clip.narrationEn : clip.narrationId)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  const voice = resolveVoice(job.voice);
  const engineLabel = voice.engine === "edge" ? "Edge Neural" : "ZAI";
  let lastError = "Unknown TTS error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await synthesizeTTS({ text: narration, voiceId: job.voice, outPath: audioPath });
      return await probeDuration(audioPath);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[production-runner] tts(${voice.engine}) klip ${clip.index} attempt ${attempt}/3 gagal: ${lastError}`);
      await sleep(900 * attempt);
    }
  }
  throw new Error(`Gagal membuat narasi klip ${clip.index} (${engineLabel}): ${lastError}`);
}

// ------------------------------------------------------- single clip (API) ---

export async function generateClipAssets(jobId: string, index: number): Promise<{
  illustration: string;
  audio: string;
  audioDuration: number;
}> {
  const job = readJob(jobId);
  const clip = job.proposal.clips.find((c) => c.index === index);
  if (!clip) throw new Error(`Klip ${index} tidak ada dalam proposal.`);
  const assetsDir = path.join(jobDir(jobId), "assets");
  const imagePath = path.join(assetsDir, `clip-${index}.png`);
  const audioPath = path.join(assetsDir, `clip-${index}.wav`);

  await generateClipImage(job, clip, imagePath);
  writeProgress(jobId, {
    clips: { [index]: { image: true, illustration: `/api/media/${jobId}/assets/clip-${index}.png` } },
  });

  const audioDuration = await generateClipAudio(job, clip, audioPath);
  writeProgress(jobId, {
    clips: { [index]: { image: true, audio: true, audioDuration } },
  });

  return {
    illustration: `/api/media/${jobId}/assets/clip-${index}.png`,
    audio: `/api/media/${jobId}/assets/clip-${index}.wav`,
    audioDuration,
  };
}

// ----------------------------------------------------------------- render ---

export async function renderJob(jobId: string): Promise<RenderResult> {
  const job = readJob(jobId);
  const dir = jobDir(jobId);
  const assetsDir = path.join(dir, "assets");
  const clips = [...job.proposal.clips].sort((a, b) => a.index - b.index);

  // Verify every clip has its assets.
  for (const clip of clips) {
    const wav = path.join(assetsDir, `clip-${clip.index}.wav`);
    const png = path.join(assetsDir, `clip-${clip.index}.png`);
    if (!fs.existsSync(wav) || !fs.existsSync(png)) {
      throw new Error(`Aset klip ${clip.index} belum lengkap — buat semua aset dulu.`);
    }
  }

  recordJobStage(jobId, "render");
  writeProgress(jobId, {
    stage: "render",
    render: { message: "Menganimasikan klip dengan canvas renderer…", pct: 3 },
  });

  try {
    // ------------------------------------- canvas-rendered animated clips
    const films: string[] = [];
    const globalCues: { text: string; start: number; end: number }[] = [];
    let globalStart = 0;

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const narration = (job.narrationLang === "en" ? clip.narrationEn : clip.narrationId)
        .replace(/\s+/g, " ")
        .trim();

      // Durasi audio bisa dari progress (hemat probe) atau probe ulang.
      const progress = readProgress(jobId);
      const known = progress.clips[clip.index]?.audioDuration;
      const audioDuration = known && known > 0 ? known : await probeDuration(path.join(assetsDir, `clip-${clip.index}.wav`));

      const { projectPath, duration, cues } = buildClipCanvasProject({
        jobId,
        index: clip.index,
        clipCount: clips.length,
        title: job.proposal.title,
        styleCode: job.proposal.styleCode,
        ratio: job.proposal.ratio,
        audioDuration,
        narration,
      });

      for (const cue of cues) {
        globalCues.push({ text: cue.text, start: globalStart + cue.start, end: globalStart + cue.end });
      }

      await runCanvasRender(projectPath, (line) => {
        writeProgress(jobId, {
          stage: "render",
          render: {
            message: `Canvas renderer: klip ${i + 1}/${clips.length} (shot ${line.shot}/${line.total})…`,
            pct: Math.min(78, Math.round(5 + (72 * i) / clips.length)),
          },
        });
      });

      const film = path.join(dir, "canvas", `clip-${clip.index}`, "output", "film.mp4");
      if (!fs.existsSync(film)) throw new Error(`Film klip ${clip.index} tidak dihasilkan renderer.`);
      films.push(film);
      globalStart += duration;
    }

    const total = globalStart;

    // ------------------------------------------------------------ concat
    writeProgress(jobId, {
      stage: "render",
      render: { message: "Menggabungkan klip teranimasi…", pct: 84 },
    });
    const listPath = path.join(dir, "concat.txt");
    fs.writeFileSync(listPath, films.map((f) => `file '${f}'`).join("\n") + "\n");
    const finalPath = path.join(dir, "final.mp4");
    try {
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", finalPath]);
    } catch {
      // Fallback: parameter encoder sedikit berbeda → re-encode.
      await runFfmpeg([
        "-f", "concat", "-safe", "0", "-i", listPath,
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalPath,
      ]);
    }

    // -------------------------------------------------------- poster + srt
    writeProgress(jobId, { stage: "render", render: { message: "Membuat poster & subtitle…", pct: 94 } });
    const posterPath = path.join(dir, "poster.jpg");
    await runFfmpeg(["-ss", "1.4", "-i", finalPath, "-frames:v", "1", "-q:v", "3", posterPath]);
    fs.writeFileSync(path.join(dir, "captions.srt"), buildSrt(globalCues));

    const result: RenderResult = {
      duration: Number(total.toFixed(2)),
      videoUrl: `/api/media/${jobId}/final.mp4`,
      posterUrl: `/api/media/${jobId}/poster.jpg`,
      srtUrl: `/api/media/${jobId}/captions.srt`,
    };
    writeProgress(jobId, {
      stage: "done",
      render: { message: "Selesai", pct: 100 },
      totalDuration: total,
      result,
    });
    await recordJobDone(jobId, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan render tidak diketahui";
    console.error(`[production-runner] render ${jobId} gagal: ${message}`);
    writeProgress(jobId, { stage: "error", message: `Render gagal: ${message}` });
    await recordJobError(jobId, message);
    throw new Error(`Render gagal: ${message}`);
  }
}

// ------------------------------------------------------------- full pipeline ---

function clipAssetsComplete(jobId: string, index: number): boolean {
  const assetsDir = path.join(jobDir(jobId), "assets");
  return (
    fs.existsSync(path.join(assetsDir, `clip-${index}.png`)) &&
    fs.existsSync(path.join(assetsDir, `clip-${index}.wav`))
  );
}

/**
 * Runs the entire production for a job in the background: generates missing
 * clip assets one by one, then canvas-renders the final MP4. Safe to call
 * twice — a job already running is ignored. Existing assets are reused, so
 * this also works as a resume after a crash or server restart.
 */
export async function runProductionJob(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  // Lock dari proses lain (atau instance modul lama) yang masih hidup: jangan
  // mulai run kedua.
  if (isJobRunning(jobId)) return;
  running.add(jobId);
  fs.writeFileSync(jobLockPath(jobId), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const job = readJob(jobId);
    const clips = [...job.proposal.clips].sort((a, b) => a.index - b.index);
    writeProgress(jobId, { stage: "assets", message: "Menyiapkan aset produksi…" });
    await recordJobStart({
      jobId,
      mode: "A",
      title: job.proposal.title,
      topic: job.proposal.logline,
      ratio: job.proposal.ratio,
      styleCode: job.proposal.styleCode,
      styleName: job.proposal.styleName,
      voice: job.voice,
      narrationLang: job.narrationLang,
      proposalJson: JSON.stringify(job.proposal),
    });

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (clipAssetsComplete(jobId, clip.index)) continue;
      writeProgress(jobId, {
        message: `Klip ${clip.index} (${i + 1}/${clips.length}): membuat ilustrasi & narasi…`,
      });
      await generateClipAssets(jobId, clip.index);
    }

    await renderJob(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan produksi tidak diketahui";
    console.error(`[production-runner] job ${jobId} gagal: ${message}`);
    writeProgress(jobId, { stage: "error", message });
    await recordJobError(jobId, message);
  } finally {
    running.delete(jobId);
    try {
      fs.rmSync(jobLockPath(jobId), { force: true });
    } catch {
      // biarkan: isJobRunning sudah memvalidasi lewat PID
    }
  }
}
