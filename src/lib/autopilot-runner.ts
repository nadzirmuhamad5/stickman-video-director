import fs from "node:fs";
import path from "node:path";
import { jobDir, probeDuration, runFfmpeg, writeProgress } from "@/lib/production";
import { synthesizeTTS } from "@/lib/tts";
import { resolveVoice } from "@/lib/tts-voices";
import { llmComplete, extractJson } from "@/lib/gemini";
import {
  buildAutopilotProject,
  runCanvasRender,
  type AutopilotBeat,
  type AutopilotScene,
} from "@/lib/canvas-project";
import { recordJobDone, recordJobError, recordJobStage, recordJobStart } from "@/lib/production-db";
import { isJobRunning, jobLockPath, type RenderResult } from "@/lib/production-runner";

// ---------------------------------------------------------------------------
// Mode B · Autopilot: one-click video generation straight from a topic.
// topic → AI script (scenes) → Edge TTS voice → canvas-rendered animated
// scenes (stickman pose, crayon props, keyword cards, draw-in strokes, SFX)
// → final MP4 with burned-in captions. Runs fully on the server.
// ---------------------------------------------------------------------------

export type AutopilotJob = {
  id: string;
  mode: "B";
  createdAt: string;
  topic: string;
  title?: string;
  ratio: string;
  styleB: "B1" | "B2";
  durationSeconds: number;
  narrationLang: "id" | "en";
  voice: string;
  ttsEngine: "edge" | "zai";
};

const ALLOWED_ASSETS = [
  "@b1/calendar-crayon.png",
  "@b1/camera-handdrawn.png",
  "@b1/clapper-crayon.png",
  "@b1/idea-bulb-crayon.png",
  "@b1/idea-note-crayon.png",
  "@b1/open-source-crayon.png",
  "@b1/script-page-crayon.png",
  "@b1/youtube-crayon.png",
];

const runningB = new Set<string>();

export function isAutopilotRunning(jobId: string): boolean {
  return runningB.has(jobId) || isJobRunning(jobId);
}

/**
 * Fallback deterministik: pecah narasi menjadi 2-4 label progresif (±7 kata)
 * supaya visual tetap mengikuti alur kalimat bila model tidak memberi beats.
 */
function deriveBeats(narration: string, pose: number, asset: string): AutopilotBeat[] {
  const words = narration.split(" ").filter(Boolean);
  if (words.length < 6) return [];
  const target = Math.max(2, Math.min(4, Math.round(words.length / 7)));
  const per = Math.ceil(words.length / target);
  const beats: AutopilotBeat[] = [];
  for (let i = 0; i < words.length && beats.length < target; i += per) {
    const label = words.slice(i, i + per).join(" ");
    if (!label) continue;
    beats.push({
      label: label.slice(0, 34),
      pose: ((pose + beats.length) % 3) as 0 | 1 | 2,
      asset: beats.length === 1 && asset !== "none" ? asset : "none",
      accent: "underline",
    });
  }
  return beats;
}

function coerceBeats(
  rawBeats: unknown,
  narration: string,
  scenePose: number,
  sceneAsset: string
): AutopilotBeat[] {
  const raw = Array.isArray(rawBeats) ? (rawBeats as Record<string, unknown>[]) : [];
  const beats: AutopilotBeat[] = [];
  for (const r of raw.slice(0, 4)) {
    const label =
      typeof r.label === "string"
        ? r.label.replace(/["\u201c\u201d]/g, "").replace(/\s+/g, " ").trim().slice(0, 34)
        : "";
    if (!label) continue;
    const poseRaw = Number(r.pose);
    const pose = ([0, 1, 2] as const).includes(poseRaw as 0 | 1 | 2)
      ? (poseRaw as 0 | 1 | 2)
      : ((beats.length % 3) as 0 | 1 | 2);
    const assetRaw = typeof r.asset === "string" ? r.asset : "none";
    const asset = ALLOWED_ASSETS.includes(assetRaw) ? assetRaw : "none";
    const accent = r.accent === "arrow" || r.accent === "underline" ? r.accent : "none";
    beats.push({ label, pose, asset, accent });
  }
  if (beats.length >= 2) {
    // Maksimal 2 prop per scene agar komposisi tidak penuh sesak.
    let props = 0;
    for (const b of beats) {
      if (b.asset !== "none") {
        props++;
        if (props > 2) b.asset = "none";
      }
    }
    return beats;
  }
  return deriveBeats(narration, scenePose, sceneAsset);
}

function coerceScenes(data: unknown, sceneTarget: number): { title: string; scenes: AutopilotScene[] } {
  const d = data as Record<string, unknown>;
  const title = typeof d.title === "string" && d.title.trim() ? d.title.trim().slice(0, 80) : "Video Autopilot";
  const raw = Array.isArray(d.scenes) ? (d.scenes as Record<string, unknown>[]) : [];
  if (!raw.length) throw new Error("Naskah tanpa scene");
  const scenes: AutopilotScene[] = raw.slice(0, 14).map((s) => {
    const narration = typeof s.narration === "string" ? s.narration.replace(/\s+/g, " ").trim().slice(0, 220) : "";
    const keyword = typeof s.keyword === "string" ? s.keyword.trim().slice(0, 40) : "";
    const assetRaw = typeof s.asset === "string" ? s.asset : "none";
    const asset = ALLOWED_ASSETS.includes(assetRaw) ? assetRaw : "none";
    const poseRaw = Number(s.pose);
    const pose = [0, 1, 2].includes(poseRaw) ? poseRaw : (Math.floor(Math.random() * 3) as 0 | 1 | 2);
    const overlayRaw = s.overlay === "arrow" || s.overlay === "underline" ? s.overlay : "none";
    return {
      narration,
      keyword,
      asset,
      pose,
      overlay: overlayRaw as AutopilotScene["overlay"],
      beats: coerceBeats(s.beats, narration, pose, asset),
    };
  });
  const filled = scenes.filter((s) => s.narration);
  if (!filled.length) throw new Error("Tidak ada narasi dalam naskah");
  // minimal jumlah scene: ulang yang ada bila model pelit
  while (filled.length < Math.min(sceneTarget, 3)) {
    filled.push({ ...filled[filled.length % filled.length] } as AutopilotScene);
  }
  // Bila model tidak memilih props sama sekali (scene maupun beat), isi
  // rotasi agar gaya khas krayon tetap tampil.
  const sceneHasProp = (s: AutopilotScene) =>
    s.asset !== "none" || s.beats.some((b) => b.asset !== "none");
  if (filled.every((s) => !sceneHasProp(s))) {
    filled.forEach((s, i) => {
      s.asset = ALLOWED_ASSETS[i % ALLOWED_ASSETS.length];
      if (s.beats.length >= 2) {
        s.beats[Math.min(1, s.beats.length - 1)].asset = s.asset;
        s.asset = "none";
      }
    });
  }
  return { title, scenes: filled };
}

async function generateScript(
  job: AutopilotJob
): Promise<{ title: string; scenes: AutopilotScene[]; engine: string }> {
  const isEn = job.narrationLang === "en";
  // Bahasa Indonesia ~2.8 kata/dtk, Inggris ~2.3 kata/dtk pada TTS neural.
  const sceneTarget = Math.max(3, Math.min(14, Math.round(job.durationSeconds / (isEn ? 10 : 8))));
  const wordsPerScene = isEn ? 24 : 21;
  const totalWords = Math.round(job.durationSeconds * (isEn ? 2.3 : 2.8));
  const assetList = ALLOWED_ASSETS.map((a) => a.replace("@b1/", "")).join(", ");
  const system = `You are a viral short-video scriptwriter for hand-drawn stickman explainer videos.

STRICT RULES:
1. Write EXACTLY ${sceneTarget} scenes. Each scene narration = 1-2 spoken sentences of about ${wordsPerScene} words.
2. Total narration across all scenes must be approximately ${totalWords} words so the spoken video lasts about ${job.durationSeconds} seconds.
3. Narrative arc: scene 1 opens with a counter-intuitive hook (no generic platitudes); middle scenes deliver facts/payoffs one level deeper each; the FINAL scene ends with a memorable punchline plus a discussion question to the viewer.
4. Language of narration: ${isEn ? "English" : "Indonesian"}.
5. keyword: 1-3 words on-screen label for the scene (same language as narration). No punctuation inside keyword.
6. beats: 2-3 entries per scene, in the SAME order the narration mentions them. Each beat = { label, pose, asset, accent }:
   - label: short punchy phrase (2-5 words) copied from or tightly summarizing that moment of the narration (same language). No punctuation at the end.
   - pose: 0 (standing/talking), 1 (pointing/presenting), or 2 (walking/action) — vary across beats.
   - asset: a prop from this list ONLY where it truly fits that moment (at most 2 props per scene), otherwise "none": ${assetList}.
   - accent: "underline" for most beats, "arrow" for at most one beat per scene, "none" occasionally.
7. asset: also pick a default prop per scene from the list (or "none").
8. pose: default pose for the scene (0/1/2), varied across scenes.
9. overlay: "underline" or "arrow" for 1-2 key scenes, otherwise "none".
10. Title: catchy video title (max 70 chars), same language as narration.
11. JSON SAFETY: never use the double-quote character (") inside string values — use single quotes ' instead. Keep JSON strictly valid.

Respond with ONLY valid JSON in this exact shape:
{"title": string, "scenes": [{"narration": string, "keyword": string, "asset": string, "pose": number, "overlay": string, "beats": [{"label": string, "pose": number, "asset": string, "accent": string}]}]}`;

  const user = `Topik:\n${job.topic}\n\nDurasi target: ${job.durationSeconds} detik. Gaya: ${job.styleB} (${job.styleB === "B1" ? "hand-drawn minimal line art" : "colorful hand-drawn, warm paper"}).`;

  let lastError = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { content, engine } = await llmComplete([
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
      const parsed = coerceScenes(extractJson(content), sceneTarget);
      return { ...parsed, engine };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[autopilot-runner] script attempt ${attempt}/3 gagal: ${lastError}`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error(`Gagal menyusun naskah: ${lastError}`);
}

async function runAutopilotInner(jobId: string, job: AutopilotJob): Promise<RenderResult> {
  const dir = jobDir(jobId);
  const canvasDir = path.join(dir, "canvas");

  // ------------------------------------------------------------- script --
  writeProgress(jobId, { stage: "assets", message: "Menyusun naskah & storyboard dengan AI…" });
  const script = await generateScript(job);
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script));
  if (!job.title) job.title = script.title;

  // ----------------------------------------------------------------- tts --
  writeProgress(jobId, { stage: "assets", message: "Merekam narasi (TTS)…" });
  const voice = resolveVoice(job.voice);
  const voicePath = path.join(canvasDir, "voice.wav");
  const narrationText = script.scenes.map((s) => s.narration).join(" ").slice(0, 5000);
  let lastError = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await synthesizeTTS({ text: narrationText, voiceId: job.voice, outPath: voicePath });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[autopilot-runner] tts attempt ${attempt}/3 gagal: ${lastError}`);
      await new Promise((r) => setTimeout(r, 900 * attempt));
    }
  }
  if (!fs.existsSync(voicePath)) {
    throw new Error(`Gagal membuat narasi (${voice.engine === "edge" ? "Edge Neural" : "ZAI"}): ${lastError}`);
  }
  const voiceDuration = await probeDuration(voicePath);

  // ------------------------------------------------------- project + render
  recordJobStage(jobId, "render");
  writeProgress(jobId, {
    stage: "render",
    render: { message: "Menganimasikan scene dengan canvas renderer…", pct: 5 },
  });
  const { projectPath } = buildAutopilotProject({
    jobId,
    title: script.title,
    ratio: job.ratio,
    styleB: job.styleB,
    voiceDuration,
    scenes: script.scenes,
  });

  const report = await runCanvasRender(projectPath, (line) => {
    writeProgress(jobId, {
      stage: "render",
      render: {
        message: `Canvas renderer: scene ${line.shot}/${line.total}…`,
        pct: Math.min(88, Math.round(10 + (78 * (line.shot ?? 0)) / Math.max(1, line.total ?? 1))),
      },
    });
  });

  // -------------------------------------------------------------- finalize
  writeProgress(jobId, { stage: "render", render: { message: "Menyalin hasil akhir…", pct: 94 } });
  const film = report.output || path.join(canvasDir, "output", "film.mp4");
  const finalPath = path.join(dir, "final.mp4");
  fs.copyFileSync(film, finalPath);
  const srtSrc = path.join(canvasDir, "output", "film.srt");
  if (fs.existsSync(srtSrc)) fs.copyFileSync(srtSrc, path.join(dir, "captions.srt"));
  const posterPath = path.join(dir, "poster.jpg");
  await runFfmpeg(["-ss", "1.4", "-i", finalPath, "-frames:v", "1", "-q:v", "3", posterPath]);

  const result: RenderResult = {
    duration: Number(report.duration ?? voiceDuration) || voiceDuration,
    videoUrl: `/api/media/${jobId}/final.mp4`,
    posterUrl: `/api/media/${jobId}/poster.jpg`,
    srtUrl: `/api/media/${jobId}/captions.srt`,
  };
  writeProgress(jobId, {
    stage: "done",
    render: { message: "Selesai", pct: 100 },
    totalDuration: result.duration,
    result,
  });
  await recordJobDone(jobId, result);
  return result;
}

/** Fire-and-forget autopilot pipeline (with lock + DB persistence). */
export async function runAutopilotJob(jobId: string): Promise<void> {
  if (runningB.has(jobId)) return;
  if (isJobRunning(jobId)) return;
  runningB.add(jobId);
  fs.writeFileSync(jobLockPath(jobId), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(jobDir(jobId), "job.json"), "utf8")) as AutopilotJob;
    await recordJobStart({
      jobId,
      mode: "B",
      title: raw.title || raw.topic.slice(0, 70),
      topic: raw.topic,
      ratio: raw.ratio,
      styleCode: raw.styleB,
      styleName: raw.styleB === "B1" ? "Minimal Line Art" : "Colorful Hand-Drawn",
      voice: raw.voice,
      narrationLang: raw.narrationLang,
    });
    await runAutopilotInner(jobId, raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan autopilot tidak diketahui";
    console.error(`[autopilot-runner] job ${jobId} gagal: ${message}`);
    writeProgress(jobId, { stage: "error", message });
    await recordJobError(jobId, message);
  } finally {
    runningB.delete(jobId);
    try {
      fs.rmSync(jobLockPath(jobId), { force: true });
    } catch {
      // biarkan
    }
  }
}
