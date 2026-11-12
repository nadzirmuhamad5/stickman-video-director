import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { jobDir } from "@/lib/production";

// ---------------------------------------------------------------------------
// Builders for canvas-renderer projects consumed by the installed stickman
// skill renderer (skills/directing-stickman-videos, @napi-rs/canvas + ffmpeg).
//
// A project is {version:1, style:"B1"|"B2", width, height, fps, voice,
// shots, captions, sfx?}. The renderer enforces:
//   - duration == voiceDuration + voice.lead + voice.tail (±0.06s)
//   - shots contiguous, first start == 0, last end == duration
//   - captions single-line, sequential (start >= previous end, <= duration)
//   - layer keys: times strictly increasing, t within shot span,
//     props limited to x/y/w/angle/alpha/progress
// All motion here is canvas-driven (drift, bobbing, draw-in strokes, fades) —
// the old ffmpeg Ken Burns zoompan is gone.
// ---------------------------------------------------------------------------

export type CanvasCue = { start: number; end: number; text: string };

type Layer = {
  type: "image" | "pose" | "text" | "line" | "arrow" | "underline";
  path?: string;
  pose?: number;
  text?: string;
  points?: number[][];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  size?: number;
  bold?: boolean;
  lineWidth?: number;
  color?: string;
  alpha?: number;
  progress?: number;
  angle?: number;
  from?: number;
  to?: number;
  keys?: { t: number; x?: number; y?: number; w?: number; angle?: number; alpha?: number; progress?: number }[];
};

type Shot = { start: number; end: number; layers: Layer[] };

type CanvasProject = {
  version: 1;
  style: "B1" | "B2";
  width: number;
  height: number;
  fps: number;
  grid?: boolean;
  voice: { path: string; lead: number; tail: number; contains_sfx: false };
  shots: Shot[];
  captions: CanvasCue[];
  sfx?: { time: number; kind: "tap" | "paper" | "pop" | "chime" | "jingle"; gain: number }[];
};

export const CANVAS_FPS = 24;
const INK = "#191916";
const INK_WARM = "#3a3428";

export function styleToCanvas(styleCode: string): { style: "B1" | "B2"; ink: string } {
  // A1/A2 → B1 (pure white, dark ink); A3–A5 → B2 (warm cream, warm ink).
  return styleCode === "A1" || styleCode === "A2"
    ? { style: "B1", ink: INK }
    : { style: "B2", ink: INK_WARM };
}

function planeFor(ratio: string): { width: number; height: number; planeW: number; planeH: number } {
  return ratio === "9:16"
    ? { width: 720, height: 1280, planeW: 1280, planeH: 2275.5 }
    : { width: 1280, height: 720, planeW: 1280, planeH: 720 };
}

// ------------------------------------------------------------------ cues ----

/** Split narration into single-line chunks that never exceed maxChars. */
export function chunkSingleLine(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let buffer: string[] = [];
  for (const w of words) {
    const next = buffer.length ? `${buffer.join(" ")} ${w}` : w;
    if (next.length > maxChars && buffer.length) {
      chunks.push(buffer.join(" "));
      buffer = [w];
    } else {
      buffer = [w];
    }
  }
  if (buffer.length) chunks.push(buffer.join(" "));
  // Pecahan terakhir yang terlalu pendek digabung ke chunk sebelumnya agar
  // caption tidak menampilkan satu-dua kata sendirian (asal tetap muat
  // satu baris caption).
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < 9) {
    const last = chunks.pop()!;
    const merged = `${chunks[chunks.length - 1]} ${last}`;
    if (merged.length <= 56) chunks[chunks.length - 1] = merged;
    else chunks.push(last);
  }
  return chunks;
}

/**
 * Sequential non-overlapping single-line cues between startT and endT,
 * weighted by chunk length. Enforces the renderer's caption rules.
 */
export function buildSingleLineCues(text: string, startT: number, endT: number, maxChars: number): CanvasCue[] {
  const chunks = chunkSingleLine(text, maxChars);
  if (!chunks.length) return [];
  const usable = Math.max(0.8, endT - startT - 0.25);
  const weights = chunks.map((c) => Math.max(4, c.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  const cues: CanvasCue[] = [];
  let t = startT;
  let prevEnd = startT;
  for (let i = 0; i < chunks.length; i++) {
    const dur = Math.max(0.8, (weights[i] / sum) * usable);
    let start = Math.max(t, prevEnd);
    let end = Math.min(start + dur, endT);
    if (end - start < 0.3) break;
    cues.push({ text: chunks[i], start, end });
    prevEnd = end;
    t = start + dur;
  }
  return cues;
}

/**
 * Renderer menuntut key times strictly increasing dan t di dalam span.
 * Normalisasi: buang key di luar span, gabungkan properti pada t yang sama,
 * lalu urutkan. Dipakai untuk SEMUA layer agar mustahil duplikat t.
 */
function normalizeKeys<T extends { t: number }>(keys: T[], span: number): T[] {
  const byT = new Map<number, T>();
  for (const k of keys) {
    if (k.t < 0 || k.t > span - 0.05) continue;
    const existing = byT.get(k.t);
    if (existing) Object.assign(existing, k);
    else byT.set(k.t, { ...k });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

// --------------------------------------------------------- accents (Mode A) --

function accentLayers(index: number, span: number, planeW: number, planeH: number, ink: string): Layer[] {
  const out: Layer[] = [];
  if (span >= 2.2) {
    out.push({
      type: "underline",
      x: 90,
      y: planeH - (planeH > 720 ? 260 : 175),
      w: 300,
      lineWidth: 7,
      color: ink,
      keys: normalizeKeys(
        [
          { t: 0.9, progress: 0 },
          { t: 2.0, progress: 1 },
          { t: span - 0.6, alpha: 1 },
          { t: span - 0.15, alpha: 0 },
        ],
        span
      ),
    });
  }
  if (span >= 4 && index % 3 !== 1) {
    out.push({
      type: "arrow",
      x: planeW - 460,
      y: planeH * 0.24,
      w: 300,
      color: ink,
      keys: normalizeKeys(
        [
          { t: 2.4, progress: 0 },
          { t: 3.6, progress: 1 },
          { t: span - 0.6, alpha: 1 },
          { t: span - 0.15, alpha: 0 },
        ],
        span
      ),
    });
  }
  if (span >= 5.4 && index % 3 === 2) {
    out.push({
      type: "line",
      x: planeW * 0.55,
      y: planeH * 0.62,
      w: 220,
      lineWidth: 4,
      color: ink,
      points: [
        [0, 6],
        [55, -8],
        [110, 10],
        [165, -6],
        [220, 4],
      ],
      keys: normalizeKeys(
        [
          { t: 3.8, progress: 0 },
          { t: 5.0, progress: 1 },
          { t: span - 0.6, alpha: 1 },
          { t: span - 0.15, alpha: 0 },
        ],
        span
      ),
    });
  }
  return out;
}

// ------------------------------------------------------- Mode A: one clip ----

export type ClipCanvasInput = {
  jobId: string;
  index: number;
  clipCount: number;
  title: string;
  styleCode: string;
  ratio: string;
  audioDuration: number;
  narration: string;
};

/**
 * Build + write the canvas project for one Director-mode clip. The clip's
 * narration wav (already produced by the TTS pipeline) is referenced relative
 * to the project dir. Returns { projectPath, duration, cues }.
 */
export function buildClipCanvasProject(input: ClipCanvasInput): {
  projectPath: string;
  duration: number;
  cues: CanvasCue[];
} {
  const lead = 0.45;
  const tail = Math.max(0.15, Math.min(0.7, 12.5 - input.audioDuration - lead));
  const duration = input.audioDuration + lead + tail;
  const { style, ink } = styleToCanvas(input.styleCode);
  const plane = planeFor(input.ratio);
  const span = duration;

  // Illustration: drawn 10% larger than the plane, then slowly panned —
  // motion via canvas keys, no Ken Burns zoom.
  const imgW = plane.planeW * 1.1;
  const imgH =
    input.ratio === "9:16"
      ? imgW * 2 // generated portrait assets are 720x1440 (1:2)
      : (imgW * 768) / 1344; // landscape assets are 1344x768
  const xRange = input.ratio === "9:16" ? 110 : 56;
  const yRange = input.ratio === "9:16" ? 240 : 34;

  const layers: Layer[] = [
    {
      type: "image",
      path: `../../assets/clip-${input.index}.png`,
      w: imgW,
      h: imgH,
      keys: normalizeKeys(
        [
          { t: 0, alpha: 0.25, x: -xRange * 0.4, y: -yRange * 0.3 },
          { t: 0.5, alpha: 1 },
          { t: span * 0.55, x: -xRange * 0.75, y: -yRange * 0.8 },
          { t: span, x: -xRange, y: -yRange * 0.35 },
        ],
        span
      ),
    },
    ...accentLayers(input.index, span, plane.planeW, plane.planeH, ink),
  ];

  if (input.index === 1 && input.title && span >= 2.4) {
    layers.push({
      type: "text",
      text: input.title.slice(0, 80),
      x: 80,
      y: 70,
      w: Math.min(680, plane.planeW - 160),
      size: 58,
      bold: true,
      color: ink,
      keys: normalizeKeys(
        [
          { t: 0.3, alpha: 0, y: 92 },
          { t: 0.9, alpha: 1, y: 70 },
          { t: Math.min(3.3, span - 1.2), alpha: 1 },
          { t: Math.min(4.0, span - 0.4), alpha: 0 },
        ],
        span
      ),
    });
  }

  const maxChars = input.ratio === "9:16" ? 34 : 48;
  const cues = buildSingleLineCues(input.narration, lead, input.audioDuration + lead, maxChars);

  const project: CanvasProject = {
    version: 1,
    style,
    width: plane.width,
    height: plane.height,
    fps: CANVAS_FPS,
    voice: { path: `../../assets/clip-${input.index}.wav`, lead, tail, contains_sfx: false },
    shots: [{ start: 0, end: Number(duration.toFixed(3)), layers }],
    captions: cues,
  };

  const dir = path.join(jobDir(input.jobId), "canvas", `clip-${input.index}`);
  fs.mkdirSync(dir, { recursive: true });
  const projectPath = path.join(dir, "project.json");
  fs.writeFileSync(projectPath, JSON.stringify(project));
  return { projectPath, duration, cues };
}

// ------------------------------------------------- Mode B: autopilot video ----

export type AutopilotScene = {
  narration: string;
  keyword: string;
  asset: string; // "@b1/<file>.png" or "none"
  pose: number; // 0 | 1 | 2 (B1 pose atlas)
  overlay: "underline" | "arrow" | "none";
};

export type AutopilotCanvasInput = {
  jobId: string;
  title: string;
  ratio: string;
  styleB: "B1" | "B2";
  voiceDuration: number;
  scenes: AutopilotScene[];
};

const POSE_BOB_Y = [0, 16, 0, 16, 0, 16, 0, 16];
const POSE_BOB_T = [0.5, 1.3, 2.1, 2.9, 3.7, 4.5, 5.3, 6.1];

/**
 * Build + write the full autopilot project (one shot per scene). Voice wav is
 * expected at canvas/voice.wav inside the job dir. Returns { projectPath,
 * duration, cues }.
 */
export function buildAutopilotProject(input: AutopilotCanvasInput): {
  projectPath: string;
  duration: number;
  cues: CanvasCue[];
} {
  const lead = 0.5;
  const tail = 0.9;
  const duration = input.voiceDuration + lead + tail;
  const plane = planeFor(input.ratio);
  const ink = input.styleB === "B2" ? INK_WARM : INK;

  // Scene spans proportional to narration length.
  const weights = input.scenes.map((s) => Math.max(10, s.narration.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const usable = Math.max(1, duration - lead - tail);
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < input.scenes.length; i++) {
    starts.push(acc);
    acc += (weights[i] / weightSum) * usable;
  }
  const ends: number[] = input.scenes.map((_, i) =>
    i === input.scenes.length - 1 ? duration : starts[i + 1]
  );

  const shots: Shot[] = [];
  const captions: CanvasCue[] = [];
  const sfx: NonNullable<CanvasProject["sfx"]> = [];
  const sfxKinds = ["pop", "chime", "paper", "tap"] as const;

  input.scenes.forEach((scene, i) => {
    const shotStart = starts[i];
    const shotEnd = ends[i];
    const span = Math.max(0.8, shotEnd - shotStart);
    const layers: Layer[] = [];

    // Title card on the opening scene.
    if (i === 0 && input.title && span >= 1.2) {
      layers.push({
        type: "text",
        text: input.title.slice(0, 80),
        x: 90,
        y: plane.planeH * 0.1,
        w: plane.planeW - 180,
        size: 92,
        bold: true,
        color: ink,
        keys: normalizeKeys(
          [
            { t: 0.2, alpha: 0 },
            { t: 0.8, alpha: 1 },
            { t: Math.min(2.8, span - 0.7), alpha: 1 },
            { t: Math.min(3.4, span - 0.15), alpha: 0 },
          ],
          span
        ),
      });
    }

    // Stickman pose with a gentle bobbing loop (B1 pose atlas).
    if (input.styleB === "B1") {
      const baseY = plane.planeH * 0.36;
      layers.push({
        type: "pose",
        pose: Math.max(0, Math.min(2, Math.round(scene.pose))),
        x: 110,
        y: baseY,
        w: 380,
        keys: normalizeKeys(
          [
            { t: 0, alpha: 0 },
            { t: 0.35, alpha: 1 },
            ...POSE_BOB_T.map((bt, bi) => ({ t: bt, y: baseY + POSE_BOB_Y[bi] })),
          ],
          span
        ),
      });
    }

    // Bundled crayon prop, floating in with a slight swing.
    if (scene.asset && scene.asset.startsWith("@b1/")) {
      layers.push({
        type: "image",
        path: scene.asset,
        x: plane.planeW - 430,
        y: 120,
        w: 320,
        keys: normalizeKeys(
          [
            { t: 0.3, alpha: 0, angle: -0.07 },
            { t: 0.9, alpha: 1, angle: 0.03 },
            { t: 2.0, angle: -0.04 },
            { t: Math.max(2.4, Math.min(3.0, span - 0.3)), angle: 0.03 },
          ],
          span
        ),
      });
    }

    // Keyword card sliding up + underline drawing itself.
    const kwY = plane.planeH * (i === 0 ? 0.3 : 0.27);
    const kwHasAsset = Boolean(scene.asset && scene.asset.startsWith("@b1/"));
    if (scene.keyword) {
      layers.push({
        type: "text",
        text: scene.keyword.slice(0, 60),
        x: 560,
        y: kwY,
        w: kwHasAsset ? 340 : 620,
        size: kwHasAsset ? 64 : 76,
        bold: true,
        color: ink,
        keys: normalizeKeys(
          [
            { t: 0.15, alpha: 0, y: kwY + 28 },
            { t: 0.75, alpha: 1, y: kwY },
          ],
          span
        ),
      });
      layers.push({
        type: "underline",
        x: 560,
        y: kwY + (kwHasAsset ? 88 : 104),
        w: 300,
        lineWidth: 7,
        color: ink,
        keys: normalizeKeys(
          [
            { t: 0.9, progress: 0 },
            { t: 1.9, progress: 1 },
          ],
          span
        ),
      });
    }

    if (scene.overlay === "arrow" && span >= 2.5) {
      layers.push({
        type: "arrow",
        x: 580,
        y: plane.planeH * 0.62,
        w: 320,
        color: ink,
        keys: normalizeKeys(
          [
            { t: 1.2, progress: 0 },
            { t: 2.3, progress: 1 },
            { t: span - 0.5, alpha: 1 },
            { t: span - 0.1, alpha: 0 },
          ],
          span
        ),
      });
    }

    shots.push({ start: Number(shotStart.toFixed(3)), end: Number(shotEnd.toFixed(3)), layers });

    // Scene caption: single-line chunks inside the scene window.
    const maxChars = input.ratio === "9:16" ? 40 : 52;
    const sceneCues = buildSingleLineCues(
      scene.narration,
      shotStart + (i === 0 ? lead : 0.15),
      shotEnd - 0.12,
      maxChars
    );
    captions.push(...sceneCues);

    sfx.push({
      time: Number((shotStart + 0.12).toFixed(2)),
      kind: sfxKinds[i % sfxKinds.length],
      gain: 0.14,
    });
  });

  const project: CanvasProject = {
    version: 1,
    style: input.styleB,
    width: plane.width,
    height: plane.height,
    fps: CANVAS_FPS,
    grid: input.styleB === "B1",
    voice: { path: "voice.wav", lead, tail, contains_sfx: false },
    shots,
    captions,
    sfx,
  };

  const dir = path.join(jobDir(input.jobId), "canvas");
  fs.mkdirSync(dir, { recursive: true });
  const projectPath = path.join(dir, "project.json");
  fs.writeFileSync(projectPath, JSON.stringify(project));
  return { projectPath, duration, cues: captions };
}

// ------------------------------------------------------------- render exec ---

export type RenderProgressLine = { shot?: number; total?: number };

/**
 * Spawn the skill's canvas renderer for a project file. onShot reports
 * per-shot progress lines from the renderer.
 */
export function runCanvasRender(
  projectPath: string,
  onShot?: (line: RenderProgressLine) => void
): Promise<{ output: string; duration: number; frames: number }> {
  const wrapper = path.join(process.cwd(), "scripts", "render-autopilot.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn("node", [wrapper, projectPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let allOut = "";
    let lineBuf = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      const text = b.toString();
      allOut += text;
      lineBuf += text;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed) as RenderProgressLine;
          if (typeof parsed.shot === "number" && onShot) onShot(parsed);
        } catch {
          // bukan baris progress — abaikan
        }
      }
    });
    child.stderr.on("data", (b: Buffer) => (stderr = (stderr + b.toString()).slice(-3000)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Canvas renderer exit ${code}: ${stderr || "tanpa stderr"}`));
        return;
      }
      const marker = allOut.indexOf("REPORT_JSON:");
      if (marker === -1) {
        reject(new Error(`Laporan renderer tidak ditemukan: ${stderr || allOut.slice(-400)}`));
        return;
      }
      try {
        const report = JSON.parse(allOut.slice(marker + "REPORT_JSON:".length).trim());
        resolve(report);
      } catch (err) {
        reject(new Error(`Laporan renderer tidak valid: ${err instanceof Error ? err.message : err}`));
      }
    });
  });
}
