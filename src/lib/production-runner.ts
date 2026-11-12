import fs from "node:fs";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import {
  buildCues,
  buildSrt,
  buildScenePrompt,
  CAPTION_FONT,
  computeTimings,
  drawTextEscaped,
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

// ---------------------------------------------------------------------------
// Server-driven production runner. The whole pipeline (image + TTS per clip,
// then render) runs in the background on the server, so a closed or refreshed
// browser tab can no longer abort production halfway through. The client only
// polls /api/production/status/[jobId] for progress.
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
const lockPath = (jobId: string) => path.join(jobDir(jobId), "running.lock");

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
    const raw = JSON.parse(fs.readFileSync(lockPath(jobId), "utf8")) as { pid?: number };
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

const RENDER_PLAN: Record<string, { w: number; h: number; out: { w: number; h: number } }> = {
  "16:9": { w: 1920, h: 1080, out: { w: 1280, h: 720 } },
  "9:16": { w: 1080, h: 1920, out: { w: 720, h: 1280 } },
};

export async function renderJob(jobId: string): Promise<RenderResult> {
  const job = readJob(jobId);
  const dir = jobDir(jobId);
  const assetsDir = path.join(dir, "assets");
  const captionsDir = path.join(dir, "captions");
  const clips = [...job.proposal.clips].sort((a, b) => a.index - b.index);

  // Verify every clip has its assets and measure narration durations.
  const audioDurations: number[] = [];
  for (const clip of clips) {
    const wav = path.join(assetsDir, `clip-${clip.index}.wav`);
    const png = path.join(assetsDir, `clip-${clip.index}.png`);
    if (!fs.existsSync(wav) || !fs.existsSync(png)) {
      throw new Error(`Aset klip ${clip.index} belum lengkap — buat semua aset dulu.`);
    }
    audioDurations.push(await probeDuration(wav));
  }

  const timings = computeTimings(audioDurations);
  const total = timings.reduce((a, t) => a + t.duration, 0);
  const plane = RENDER_PLAN[job.proposal.ratio === "9:16" ? "9:16" : "16:9"];
  const captionDark = job.proposal.styleCode !== "A3";
  const fontColor = captionDark ? "0x232323" : "0xFFFFFF";
  const borderColor = captionDark ? "white@0.9" : "black@0.85";

  writeProgress(jobId, {
    stage: "render",
    render: { message: "Merender segmen klip…", pct: 5 },
  });

  try {
    // ----------------------------------------------------------- segments
    const segFiles: string[] = [];
    const globalCues: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const timing = timings[i];
      const frames = Math.round(timing.duration * 24);
      const segPath = path.join(dir, `seg-${i}.mp4`);
      const narration = job.narrationLang === "en" ? clip.narrationEn : clip.narrationId;

      // Caption cues for this clip.
      const cues = buildCues(narration, timing.duration, job.proposal.ratio);
      for (const cue of cues) {
        globalCues.push({
          text: cue.text,
          start: timing.start + cue.start,
          end: timing.start + cue.end,
        });
      }

      const drawtexts: string[] = [];
      cues.forEach((cue, ci) => {
        const file = path.join(captionsDir, `c-${i}-${ci}.txt`);
        fs.writeFileSync(file, drawTextEscaped(cue.lines));
        drawtexts.push(
          `drawtext=fontfile=${CAPTION_FONT}:textfile=${file}` +
            `:fontsize=${job.proposal.ratio === "9:16" ? 34 : 34}:fontcolor=${fontColor}` +
            `:borderw=4:bordercolor=${borderColor}` +
            `:x=(w-text_w)/2:y=h-${job.proposal.ratio === "9:16" ? 190 : 150}` +
            `:line_spacing=8:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'`
        );
      });

      if (i === 0) {
        const titleFile = path.join(captionsDir, "title.txt");
        const maxChars = job.proposal.ratio === "9:16" ? 22 : 34;
        const words = job.proposal.title.split(/\s+/);
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
          const next = line ? `${line} ${w}` : w;
          if (next.length > maxChars && line) {
            lines.push(line);
            line = w;
          } else line = next;
        }
        if (line && lines.length < 3) lines.push(line);
        fs.writeFileSync(titleFile, lines.join("\n"));
        drawtexts.push(
          `drawtext=fontfile=${CAPTION_FONT}:textfile=${titleFile}` +
            `:fontsize=${job.proposal.ratio === "9:16" ? 46 : 52}:fontcolor=${fontColor}` +
            `:borderw=5:bordercolor=${borderColor}` +
            `:x=(w-text_w)/2:y=h*0.13:line_spacing=10` +
            `:alpha='min(1,max(0,min((t-0.3)/0.5,(3.6-t)/0.4)))'` +
            `:enable='between(t,0.3,3.7)'`
        );
      }

      const zoomExpr =
        i % 2 === 0
          ? `1+0.12*on/${frames - 1}`
          : `1.12-0.12*on/${frames - 1}`;

      const filter =
        `[0:v]scale=${plane.w}:${plane.h}:force_original_aspect_ratio=increase` +
        `,crop=${plane.w}:${plane.h}` +
        `,zoompan=z='${zoomExpr}'` +
        `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=1:s=${plane.out.w}x${plane.out.h}:fps=24` +
        `,fade=t=in:st=0:d=0.35,fade=t=out:st=${(timing.duration - 0.35).toFixed(2)}:d=0.35` +
        `,${drawtexts.join(",")}[vout]`;

      await runFfmpeg([
        "-framerate",
        "24",
        "-loop",
        "1",
        "-t",
        timing.duration.toFixed(3),
        "-i",
        path.join(assetsDir, `clip-${clip.index}.png`),
        "-filter_complex",
        filter,
        "-map",
        "[vout]",
        "-frames:v",
        String(frames),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        segPath,
      ]);
      segFiles.push(segPath);
      writeProgress(jobId, {
        stage: "render",
        render: {
          message: `Merender klip ${i + 1}/${clips.length}…`,
          pct: Math.round(10 + (70 * (i + 1)) / clips.length),
        },
      });
    }

    // -------------------------------------------------------------- concat
    const listPath = path.join(dir, "concat.txt");
    fs.writeFileSync(listPath, segFiles.map((f) => `file '${f}'`).join("\n") + "\n");
    const silentPath = path.join(dir, "video-silent.mp4");
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", silentPath]);
    writeProgress(jobId, {
      stage: "render",
      render: { message: "Menggabungkan klip…", pct: 82 },
    });

    // ---------------------------------------------------------- audio mix
    const args: string[] = ["-i", silentPath];
    clips.forEach((c) => args.push("-i", path.join(assetsDir, `clip-${c.index}.wav`)));
    const delays: string[] = [];
    const mixes: string[] = [];
    timings.forEach((t, i) => {
      const ms = Math.round(t.start * 1000);
      delays.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
      mixes.push(`[a${i}]`);
    });
    const finalPath = path.join(dir, "final.mp4");
    args.push(
      "-filter_complex",
      `${delays.join(";")};${mixes.join("")}amix=inputs=${mixes.length}:normalize=0:duration=longest` +
        `,apad,atrim=0:${total.toFixed(3)},alimiter=limit=0.95[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      finalPath
    );
    await runFfmpeg(args);

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
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan render tidak diketahui";
    console.error(`[production-runner] render ${jobId} gagal: ${message}`);
    writeProgress(jobId, { stage: "error", message: `Render gagal: ${message}` });
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
 * clip assets one by one, then renders the final MP4. Safe to call twice —
 * a job already running is ignored. Existing assets are reused, so this also
 * works as a resume after a crash or server restart.
 */
export async function runProductionJob(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  // Lock dari proses lain (atau instance modul lama) yang masih hidup: jangan
  // mulai run kedua.
  if (isJobRunning(jobId)) return;
  running.add(jobId);
  fs.writeFileSync(lockPath(jobId), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const job = readJob(jobId);
    const clips = [...job.proposal.clips].sort((a, b) => a.index - b.index);
    writeProgress(jobId, { stage: "assets", message: "Menyiapkan aset produksi…" });

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
  } finally {
    running.delete(jobId);
    try {
      fs.rmSync(lockPath(jobId), { force: true });
    } catch {
      // biarkan: isJobRunning sudah memvalidasi lewat PID
    }
  }
}
