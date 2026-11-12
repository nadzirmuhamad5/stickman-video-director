import fs from "node:fs";
import path from "node:path";
import { jobDir, probeDuration, runFfmpeg, sleep, writeProgress } from "@/lib/production";
import { synthesizeTTS } from "@/lib/tts";
import { findVoice, resolveVoice } from "@/lib/tts-voices";
import { geminiImage, llmComplete, extractJson } from "@/lib/gemini";
import {
  buildAutopilotProject,
  buildB3Project,
  buildB4Project,
  runCanvasRender,
  type AutopilotBeat,
  type AutopilotScene,
  type StyleB,
} from "@/lib/canvas-project";
import { ensurePropImages, sanitizePropHint, stagePropsIntoCanvasDir } from "@/lib/prop-art";
import { recordJobDone, recordJobError, recordJobStage, recordJobStart } from "@/lib/production-db";
import { isJobRunning, jobLockPath, type RenderResult } from "@/lib/production-runner";

// ---------------------------------------------------------------------------
// Mode B · Autopilot: one-click video generation straight from a topic.
// topic → AI script (scenes + beats) → Edge TTS voice → canvas-rendered
// animation:
//   B1/B2 — stickman pose + AI-generated topic props (prop-art, no key
//           needed) + keyword cards + draw-in strokes + SFX;
//   B3    — pure-vector Retro TV scenes (dark field, white/gray figures,
//           rotating object panels, television finish);
//   B4    — Gemini full-scene illustrations anchored to the installed B4
//           style-lock references, ≤3 s narrative shots, dark ambience bed,
//           Brian-style narrator, warm-white captions.
// → final MP4 with burned-in captions. Runs fully on the server.
// ---------------------------------------------------------------------------

export type AutopilotJob = {
  id: string;
  mode: "B";
  createdAt: string;
  topic: string;
  title?: string;
  ratio: string;
  styleB: StyleB;
  durationSeconds: number;
  narrationLang: "id" | "en";
  voice: string;
  ttsEngine: "edge" | "zai";
};

export const STYLE_B_NAMES: Record<StyleB, string> = {
  B1: "Minimal Line Art",
  B2: "Colorful Hand-Drawn",
  B3: "Retro TV",
  B4: "Survival Thriller",
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

// B4 style-lock resources from the installed skill (drawing authority).
const SKILL_ROOT = path.join(process.cwd(), "skills", "directing-stickman-videos");
const B4_STYLE_LOCK = path.join(SKILL_ROOT, "assets", "b4", "style-lock.txt");
const B4_REFS = {
  indoor: path.join(SKILL_ROOT, "assets", "b4", "reference-01-motor-room.png"),
  outdoor: path.join(SKILL_ROOT, "assets", "b4", "reference-04-street.png"),
};

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
    // Objek konkret dari narasi — jadi dasar prop ilustrasi AI (B1/B2).
    const prop = typeof r.prop === "string" ? sanitizePropHint(r.prop) : "";
    beats.push({ label, pose, asset, accent, prop: prop || undefined });
  }
  if (beats.length >= 2) {
    // Maksimal 2 prop bundel per scene agar komposisi tidak penuh sesak.
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
    const locationRaw = s.location === "indoor" || s.location === "outdoor" ? s.location : "indoor";
    return {
      narration,
      keyword,
      asset,
      pose,
      overlay: overlayRaw as AutopilotScene["overlay"],
      location: locationRaw,
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
  const isB4 = job.styleB === "B4";
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
6. beats: 2-3 entries per scene, in the SAME order the narration mentions them. Each beat = { label, pose, asset, accent, prop }:
   - label: short punchy phrase (2-5 words) copied from or tightly summarizing that moment of the narration (same language). No punctuation at the end.
   - pose: 0 (standing/talking), 1 (pointing/presenting), or 2 (walking/action) — vary across beats.
   - prop: THE single most concrete physical object mentioned or implied at that exact moment of the narration, 1-3 words, a common noun (same language, e.g. gurita, jantung, roket, gelas kopi, dompet). Every beat MUST have a prop — this object is drawn as an illustration on screen. No punctuation.
   - asset: a prop from this list ONLY where it truly fits that moment (at most 2 per scene), otherwise "none": ${assetList}.
   - accent: "underline" for most beats, "arrow" for at most one beat per scene, "none" occasionally.
7. asset: also pick a default prop per scene from the list (or "none").
8. pose: default pose for the scene (0/1/2), varied across scenes.
9. overlay: "underline" or "arrow" for 1-2 key scenes, otherwise "none".
10. Title: catchy video title (max 70 chars), same language as narration.
11. JSON SAFETY: never use the double-quote character (") inside string values — use single quotes ' instead. Keep JSON strictly valid.
${
  isB4
    ? `\nB4 SURVIVAL-THRILLER DIRECTION (overrides tone, not format):
12. Genre: survival thriller / dark suspense. The narration builds tension: an ordinary situation turns threatening, stakes escalate beat by beat, the ending lands on a chilling cliffhanger question instead of a friendly discussion prompt.
13. location: each scene MUST also carry "location": "indoor" or "outdoor" — where that moment happens.
14. beats for B4: label = a 3-6 word VISUAL shot description of what the camera shows at that moment (concrete place + action + mood, e.g. 'koridor gelap lampu berkedip'). These drive scene illustrations, so describe PICTURES, not concepts.
`
    : ""
}
Respond with ONLY valid JSON in this exact shape:
{"title": string, "scenes": [{"narration": string, "keyword": string, "asset": string, "pose": number, "overlay": string${isB4 ? ', "location": "indoor" | "outdoor"' : ""}, "beats": [{"label": string, "pose": number, "asset": string, "accent": string, "prop": string}]}]}`;

  const user = `Topik:\n${job.topic}\n\nDurasi target: ${job.durationSeconds} detik. Gaya: ${job.styleB} (${
    job.styleB === "B1"
      ? "hand-drawn minimal line art"
      : job.styleB === "B2"
        ? "colorful hand-drawn, warm paper"
        : job.styleB === "B3"
          ? "retro TV, dark field, white/gray vector silhouettes"
          : "survival thriller, cinematic dark illustrations"
  }).`;

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

// ----------------------------------------------------- visual asset stage ---

/** Bed ambience gelap untuk B4: brown noise (rumble) + wind band 250–3 kHz
 *  (wajib terdengar di 0.1s pertama untuk kontrak opening B4) — WAV 48 kHz. */
export function writeB4Ambience(wavPath: string, seconds = 24): void {
  const rate = 48000;
  const n = Math.ceil(seconds * rate);
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(n * 2, 40);
  let brown = 0;
  let wind = 0;
  let seed = 9973;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const w = rand();
    brown = (brown + w * 0.02) * 0.995;
    wind += 0.35 * (w - wind); // lowpass ~2.7 kHz → angin gelap yang terukur
    const swell =
      0.72 + 0.28 * Math.sin(2 * Math.PI * 0.05 * t) * Math.sin(2 * Math.PI * 0.013 * t + 1.3);
    const v = Math.max(-1, Math.min(1, (brown * 2.4 + wind * 1.4) * swell));
    bytes.writeInt16LE(Math.round(v * 32767 * 0.9), 44 + i * 2);
  }
  fs.writeFileSync(wavPath, bytes);
}

/**
 * Isi asset visual per beat sesuai gaya:
 *  - B1/B2: prop ilustrasi krayon per objek narasi (ZAI, tanpa key) →
 *    transparan via prop-tools → "props/pN.png".
 *  - B3   : tanpa gambar — semua panel digambar vektor.
 *  - B4   : ilustrasi full-scene via Gemini dengan style-lock + reference
 *    bawaan → "scenes/sN.png" (wajib ada Gemini key).
 */
async function attachVisualAssets(
  jobId: string,
  job: AutopilotJob,
  scenes: AutopilotScene[]
): Promise<void> {
  const canvasDir = path.join(jobDir(jobId), "canvas");

  if (job.styleB === "B3") return;

  if (job.styleB === "B1" || job.styleB === "B2") {
    // Hanya objek konkret dari narasi (beat) yang digambar — label konsep
    // (keyword scene) tidak, supaya tidak boros kuota gambar.
    const hints = scenes
      .flatMap((s) => s.beats.map((b) => b.prop ?? ""))
      .filter(Boolean);
    const generated = await ensurePropImages(hints, job.styleB, {
      concurrency: 2,
      max: 12,
      onProgress: (done, total) =>
        writeProgress(jobId, {
          stage: "assets",
          message: `Menggambar prop sesuai narasi (${done}/${total})…`,
        }),
    });
    const staged = stagePropsIntoCanvasDir(canvasDir, generated);
    for (const s of scenes) {
      for (const b of s.beats) {
        const hit = b.prop ? staged.get(b.prop) : undefined;
        b.asset = hit ?? (b.asset !== "none" ? b.asset : "none");
      }
    }
    return;
  }

  // --- B4: ilustrasi full-scene via Gemini (style-lock + reference) --------
  const styleLock = fs.readFileSync(B4_STYLE_LOCK, "utf8");
  // Setiap scene wajib punya ≥1 beat (sumber ilustrasi shot).
  for (const s of scenes) {
    if (!s.beats.length) {
      s.beats.push({
        label: (s.keyword || s.narration.slice(0, 30)).slice(0, 34),
        pose: 0,
        asset: "none",
        accent: "none",
      });
    }
  }
  const beatsList: { scene: AutopilotScene; beat: AutopilotBeat }[] = [];
  for (const s of scenes) {
    for (const b of s.beats) beatsList.push({ scene: s, beat: b });
  }
  // Batasi jumlah ilustrasi baru; beat kelebihan memakai ilustrasi terakhir.
  const MAX_ILLUS = 14;
  const scenesDir = path.join(canvasDir, "scenes");
  fs.mkdirSync(scenesDir, { recursive: true });
  const aspect = job.ratio === "9:16" ? ("9:16" as const) : ("16:9" as const);

  let lastAsset: string | null = null;
  for (let k = 0; k < beatsList.length; k++) {
    const { scene, beat } = beatsList[k];
    if (k >= MAX_ILLUS && lastAsset) {
      beat.asset = lastAsset;
      continue;
    }
    writeProgress(jobId, {
      stage: "assets",
      message: `Ilustrasi adegan ${Math.min(k + 1, MAX_ILLUS)}/${Math.min(beatsList.length, MAX_ILLUS)} (Gemini)…`,
    });
    const refPath = scene.location === "outdoor" ? B4_REFS.outdoor : B4_REFS.indoor;
    const prompt = [
      styleLock,
      "---",
      `NEW SCENE — render a NEW full-scene story illustration in exactly this locked drawing style, using the attached reference ONLY as the drawing-style authority (do not copy its location, characters or composition).`,
      `Shot: ${beat.label}.`,
      `Narration context: ${scene.narration}`,
      `Location: ${scene.location === "outdoor" ? "outdoor night environment" : "interior environment"}.`,
      `Full-scene cinematic 2D illustration, dramatic survival-thriller staging, readable silhouettes at night.`,
      `Absolutely no text, no letters, no captions, no speech bubbles, no watermark, no logo.`,
    ].join("\n");
    let bytes: Buffer | null = null;
    let lastErr = "unknown";
    for (let attempt = 1; attempt <= 3 && !bytes; attempt++) {
      try {
        bytes = await geminiImage({
          prompt,
          refImage: { bytes: fs.readFileSync(refPath), mime: "image/png" },
          aspectRatio: aspect,
          timeoutMs: 150_000,
        });
        if (!bytes) throw new Error("Tidak ada gambar dari Gemini (key hilang / quota)");
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        await sleep(1200 * attempt);
      }
    }
    if (!bytes) {
      throw new Error(
        `Ilustrasi B4 gagal: ${lastErr}. Pastikan Gemini API key terpasang (panel Status) dan quota tersedia.`
      );
    }
    const rel = `scenes/s${k}.png`;
    fs.writeFileSync(path.join(canvasDir, rel), bytes);
    beat.asset = rel;
    lastAsset = rel;
  }
}

async function runAutopilotInner(jobId: string, job: AutopilotJob): Promise<RenderResult> {
  const dir = jobDir(jobId);
  const canvasDir = path.join(dir, "canvas");

  // ------------------------------------------------------------- script --
  writeProgress(jobId, { stage: "assets", message: "Menyusun naskah & storyboard dengan AI…" });
  const script = await generateScript(job);
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script));
  if (!job.title) job.title = script.title;

  // ---------------------------------------------------- prop / ilustrasi --
  // Objek visual mengikuti narasi: prop krayon AI (B1/B2), vektor (B3),
  // ilustrasi full-scene Gemini (B4).
  await attachVisualAssets(jobId, job, script.scenes);

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

  // B4: bed ambience gelap + identitas narator (kontrak renderer B4).
  if (job.styleB === "B4") {
    writeB4Ambience(path.join(canvasDir, "ambience.wav"), 24);
  }
  const voiceMeta = findVoice(job.voice);
  const isBrian = job.voice.startsWith("en-US-Brian");
  const voiceIdentity =
    job.styleB === "B4"
      ? {
          voiceName: isBrian ? "Brian" : voiceMeta?.label ?? job.voice,
          voiceId: job.voice,
          voiceOverride: isBrian
            ? "Edge Neural en-US-BrianNeural dipilih eksplisit di web Studio (ElevenLabs Brian tidak tersedia di server ini)"
            : `Suara dipilih eksplisit pengguna di web Studio: ${job.voice} (ElevenLabs Brian tidak tersedia di server ini)`,
        }
      : {};

  const projectInput = { jobId, title: script.title, ratio: job.ratio, styleB: job.styleB, voiceDuration, scenes: script.scenes, ...voiceIdentity };
  const { projectPath } =
    job.styleB === "B3"
      ? buildB3Project(projectInput)
      : job.styleB === "B4"
        ? buildB4Project(projectInput)
        : buildAutopilotProject(projectInput);

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
      styleName: STYLE_B_NAMES[raw.styleB] ?? raw.styleB,
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
