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
      buffer.push(w);
    }
  }
  if (buffer.length) chunks.push(buffer.join(" "));
  // Pecahan terakhir yang terlalu pendek digabung ke chunk sebelumnya agar
  // caption tidak menampilkan satu-dua kata sendirian. Batas gabungan harus
  // tetap muat SATU baris caption renderer (maks ~1120px: B1 34px ≈ 17.1px/
  // karakter → ≤58 karakter; B2 40px ≈ 20.1px/karakter → ≤50 karakter).
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < 9) {
    const last = chunks.pop()!;
    const merged = `${chunks[chunks.length - 1]} ${last}`;
    const cap = Math.min(50, maxChars + 8);
    if (merged.length <= cap) chunks[chunks.length - 1] = merged;
    else chunks.push(last);
  }
  return chunks;
}

/**
 * Sequential non-overlapping single-line cues between startT and endT,
 * weighted by chunk length. Semua chunk SELALU tampil: bila jendela terlalu
 * pendek untuk durasi natural, semua durasi dikompres proporsional (bukan
 * dipotong) sehingga tidak ada caption yang hilang. Enforces the renderer's
 * caption rules.
 */
export function buildSingleLineCues(text: string, startT: number, endT: number, maxChars: number): CanvasCue[] {
  const chunks = chunkSingleLine(text, maxChars);
  if (!chunks.length) return [];
  const usable = Math.max(0.8, endT - startT - 0.25);
  const weights = chunks.map((c) => Math.max(4, c.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  const naturals = chunks.map((_, i) => Math.max(0.7, (weights[i] / sum) * usable));
  const totalNatural = naturals.reduce((a, b) => a + b, 0);
  const scale = totalNatural > usable ? usable / totalNatural : 1;
  const cues: CanvasCue[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const dur = Math.max(0.45, naturals[i] * scale);
    const start = i === 0 ? startT : cues[i - 1].end;
    let end = Math.min(start + dur, endT);
    if (end - start < 0.35) end = Math.min(endT, start + 0.35);
    if (end <= start) break;
    cues.push({ text: chunks[i], start: round3(start), end: round3(end) });
  }
  return cues;
}

function round3(x: number): number {
  return Number(x.toFixed(3));
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

  // Caption harus muat satu baris: B1 34px ≈ 58 karakter, B2 40px ≈ 50
  // karakter pada lebar caption 1120px (diukur dengan NotoSans asli).
  const maxChars =
    input.ratio === "9:16" ? (style === "B1" ? 44 : 36) : style === "B1" ? 52 : 44;
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

export type AutopilotBeat = {
  label: string; // frasa pendek dari/ikut narasi scene
  pose: 0 | 1 | 2; // B1 pose atlas index
  asset: string; // "@b1/<file>.png" or "none"
  accent: "underline" | "arrow" | "none";
};

export type AutopilotScene = {
  narration: string;
  keyword: string;
  asset: string; // "@b1/<file>.png" or "none"
  pose: number; // 0 | 1 | 2 (B1 pose atlas)
  overlay: "underline" | "arrow" | "none";
  beats: AutopilotBeat[];
};

export type AutopilotCanvasInput = {
  jobId: string;
  title: string;
  ratio: string;
  styleB: "B1" | "B2";
  voiceDuration: number;
  scenes: AutopilotScene[];
};

type Keys = NonNullable<Layer["keys"]>;

const STICKMAN_X_916 = 110;
const STICKMAN_X_169 = 98;

function round2(x: number): number {
  return Number(x.toFixed(2));
}

type BeatWin = {
  relStart: number;
  relEnd: number;
  beat: AutopilotBeat;
  isLast: boolean;
};

/** Split the scene span into beat windows weighted by label length. */
function planBeats(beats: AutopilotBeat[], span: number): BeatWin[] {
  const maxBeats = Math.max(1, Math.floor(span / 1.3));
  const list = beats.length <= maxBeats ? beats : beats.slice(0, maxBeats);
  const weights = list.map((b) => Math.max(6, b.label.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  const wins: BeatWin[] = [];
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    const relStart = acc;
    acc += (weights[i] / sum) * span;
    wins.push({
      relStart: round3(relStart),
      relEnd: round3(i === list.length - 1 ? span : acc),
      beat: list[i],
      isLast: i === list.length - 1,
    });
  }
  return wins;
}

function fadeFor(relStart: number, relEnd: number, isLast: boolean): { inD: number; outD: number } {
  const win = relEnd - relStart;
  return {
    inD: Math.min(0.3, Math.max(0.12, win * 0.3)),
    outD: isLast ? 0 : Math.min(0.35, Math.max(0.14, win * 0.3)),
  };
}

/**
 * Stickman per beat: crossfade masuk/keluar + bobbing & sway sepanjang
 * jendela beat (bukan cuma 6 detik pertama), sehingga gerakan terus hidup.
 */
function stickKeys(
  relStart: number,
  relEnd: number,
  baseY: number,
  baseX: number,
  fade: { inD: number; outD: number },
  span: number
): Keys {
  const keys: Keys = [];
  keys.push({ t: round3(relStart), alpha: 0, y: baseY + 12, x: baseX });
  keys.push({ t: round3(relStart + fade.inD), alpha: 1, y: baseY, x: baseX });
  const endT = Math.min(relEnd, span - 0.06);
  const period = 0.8;
  let t = relStart + fade.inD + period;
  let i = 0;
  while (t < endT - (fade.outD > 0 ? fade.outD : 0) - 0.08) {
    keys.push({
      t: round3(t),
      y: baseY + (i % 2 === 0 ? -18 : 0),
      x: baseX + (i % 2 === 1 ? 12 : -12),
    });
    t += period;
    i++;
  }
  if (fade.outD > 0) {
    keys.push({ t: round3(relEnd - fade.outD), alpha: 1 });
    keys.push({
      t: round3(Math.max(relEnd - 0.06, relEnd - fade.outD + 0.05)),
      alpha: 0,
      y: baseY + 12,
      x: baseX,
    });
  } else if (t - period < endT) {
    keys.push({ t: round3(t - period + 0.4), y: baseY + (i % 2 === 0 ? -18 : 0), x: baseX });
  }
  return normalizeKeys(keys, span);
}

/** Kartu kata kunci: meluncur naik saat beat mulai, pudar sebelum beat berikut. */
function cardKeys(relStart: number, relEnd: number, y: number, span: number, isLast: boolean): Keys {
  const keys: Keys = [];
  const win = relEnd - relStart;
  const inD = Math.min(0.3, Math.max(0.12, win * 0.4));
  keys.push({ t: round3(relStart + 0.1), alpha: 0, y: y + 26 });
  keys.push({ t: round3(relStart + 0.1 + inD + 0.35), alpha: 1, y });
  if (!isLast) {
    const outD = fadeFor(relStart, relEnd, false).outD;
    keys.push({ t: round3(relEnd - outD), alpha: 1 });
    keys.push({ t: round3(Math.max(relEnd - 0.06, relEnd - outD + 0.05)), alpha: 0 });
  }
  return normalizeKeys(keys, span);
}

/** Garis/panah yang menggambar sendiri di awal beat, lalu pudar bersama kartu. */
function strokeKeys(relStart: number, relEnd: number, delay: number, span: number, isLast: boolean): Keys {
  const keys: Keys = [];
  keys.push({ t: round3(relStart + delay), progress: 0 });
  keys.push({ t: round3(Math.min(relStart + delay + 1.0, relEnd - 0.15)), progress: 1 });
  if (!isLast) {
    const outD = fadeFor(relStart, relEnd, false).outD;
    keys.push({ t: round3(relEnd - outD), alpha: 1 });
    keys.push({ t: round3(Math.max(relEnd - 0.06, relEnd - outD + 0.05)), alpha: 0 });
  }
  return normalizeKeys(keys, span);
}

/** Prop krayon: melayang masuk dengan ayunan lembut, terikat pada jendela beat. */
function propKeys(relStart: number, relEnd: number, span: number, isLast: boolean): Keys {
  const keys: Keys = [];
  keys.push({ t: round3(relStart + 0.12), alpha: 0, angle: -0.07 });
  keys.push({ t: round3(relStart + 0.5), alpha: 1, angle: 0.03 });
  let t = relStart + 1.5;
  let i = 0;
  while (t < relEnd - 0.3) {
    keys.push({ t: round3(t), angle: i % 2 === 0 ? -0.04 : 0.03 });
    t += 1.1;
    i++;
  }
  if (!isLast) {
    const outD = fadeFor(relStart, relEnd, false).outD;
    keys.push({ t: round3(relEnd - outD), alpha: 1 });
    keys.push({ t: round3(Math.max(relEnd - 0.06, relEnd - outD + 0.05)), alpha: 0 });
  }
  return normalizeKeys(keys, span);
}

/**
 * Build + write the full autopilot project (one shot per scene, 2-4 beats per
 * scene). Tiap beat punya kartu kata kunci + pose stickman + prop + aksen
 * yang muncul mengikuti urutan narasi — bukan visual statis satu scene.
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
  const is916 = input.ratio === "9:16";

  // Scene spans proportional to narration length. Semua batas langsung
  // dibulatkan ke 3 desimal agar identik dengan shot.start/end yang dibaca
  // validator renderer (span = round(end) - round(start)), sehingga key &
  // layer from/to tidak pernah melampaui span.
  const weights = input.scenes.map((s) => Math.max(10, s.narration.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const usable = Math.max(1, duration - lead - tail);
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < input.scenes.length; i++) {
    starts.push(round3(acc));
    acc += (weights[i] / weightSum) * usable;
  }
  const ends: number[] = input.scenes.map((_, i) =>
    i === input.scenes.length - 1 ? round3(duration) : starts[i + 1]
  );

  const stickBaseX = is916 ? STICKMAN_X_916 : STICKMAN_X_169;
  const stickBaseY = plane.planeH * (is916 ? 0.36 : 0.3);
  const stickW = is916 ? 380 : 300;
  const propA = is916
    ? { x: plane.planeW - 430, y: 120, w: 320 }
    : { x: plane.planeW - 360, y: 64, w: 240 };
  const propB = is916
    ? { x: plane.planeW - 380, y: plane.planeH * 0.42, w: 270 }
    : { x: plane.planeW - 330, y: plane.planeH * 0.42, w: 220 };

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
        y: is916 ? plane.planeH * 0.1 : 60,
        w: is916 ? 720 : 780,
        size: is916 ? 84 : 76,
        bold: true,
        color: ink,
        keys: normalizeKeys(
          [
            { t: 0.2, alpha: 0, y: (is916 ? plane.planeH * 0.1 : 60) + 22 },
            { t: 0.8, alpha: 1, y: is916 ? plane.planeH * 0.1 : 60 },
            { t: Math.min(2.8, span - 0.7), alpha: 1 },
            { t: Math.min(3.4, span - 0.15), alpha: 0 },
          ],
          span
        ),
      });
    }

    // Beats: fallback satu beat dari scene bila model tidak memberi beats.
    const beats: AutopilotBeat[] = scene.beats.length
      ? scene.beats
      : [
          {
            label: (scene.keyword || scene.narration.split(" ").slice(0, 3).join(" ")).slice(0, 34),
            pose: (Math.max(0, Math.min(2, Math.round(scene.pose))) as 0 | 1 | 2),
            asset: scene.asset,
            accent: scene.overlay,
          },
        ];

    planBeats(beats, span).forEach((b, bi) => {
      const fade = fadeFor(b.relStart, b.relEnd, b.isLast);
      const beatWin = b.relEnd - b.relStart;
      const propAsset =
        b.beat.asset && b.beat.asset.startsWith("@b1/") ? b.beat.asset : null;
      const kwHasAsset = Boolean(propAsset);

      // Stickman: pose berubah tiap beat, bobbing sepanjang beat. Atlas pose
      // hanya sah untuk gaya B1 (aturan renderer) — B2 memakai kartu + prop.
      if (input.styleB === "B1") {
        layers.push({
          type: "pose",
          pose: b.beat.pose,
          x: stickBaseX,
          y: stickBaseY,
          w: stickW,
          from: round3(b.relStart),
          // `to` memakai span mentah (identik dengan hitungan validator) dan
          // di-clamp — round3(span) bisa membulatkan ke ATAS dan melanggar.
          to: Math.min(b.isLast ? span : b.relEnd, span),
          keys: stickKeys(b.relStart, b.relEnd, stickBaseY, stickBaseX, fade, span),
        });
      }

      // Kartu kata kunci per beat.
      const label = (b.beat.label || scene.keyword).slice(0, 34);
      if (label) {
        const kwY = plane.planeH * (i === 0 ? 0.3 : 0.27) + (bi % 2 === 1 ? (is916 ? 44 : 40) : 0);
        layers.push({
          type: "text",
          text: label,
          x: 560,
          y: kwY,
          w: kwHasAsset ? 340 : is916 ? 620 : 560,
          size: kwHasAsset ? 62 : is916 ? 72 : 64,
          bold: true,
          color: ink,
          keys: cardKeys(b.relStart, b.relEnd, kwY, span, b.isLast),
        });
        // Aksen menggambar sendiri: underline (umum) atau arrow (sorotan).
        const accent = b.beat.accent === "arrow" && beatWin >= 2.4 ? "arrow" : "underline";
        if (accent === "arrow") {
          layers.push({
            type: "arrow",
            x: 580,
            y: plane.planeH * (is916 ? 0.62 : 0.6),
            w: 320,
            color: ink,
            keys: strokeKeys(b.relStart, b.relEnd, 1.0, span, b.isLast),
          });
        } else if (beatWin >= 1.6) {
          layers.push({
            type: "underline",
            x: 560,
            y: kwY + (kwHasAsset ? 88 : 104),
            w: 300,
            lineWidth: 7,
            color: ink,
            keys: strokeKeys(b.relStart, b.relEnd, 0.9, span, b.isLast),
          });
        }
      }

      // Prop krayon terikat beat: posisi bergantian kanan-atas / kanan-tengah.
      if (propAsset) {
        const pos = bi % 2 === 0 ? propA : propB;
        layers.push({
          type: "image",
          path: propAsset,
          x: pos.x,
          y: pos.y,
          w: pos.w,
          from: round3(b.relStart),
          to: Math.min(b.isLast ? span : b.relEnd, span),
          keys: propKeys(b.relStart, b.relEnd, span, b.isLast),
        });
      }

      // SFX pop kecil di awal tiap beat (menegaskan ritme narasi).
      sfx.push({
        time: round2(shotStart + b.relStart + 0.12),
        kind: sfxKinds[(i * 2 + bi) % sfxKinds.length],
        gain: 0.12,
      });
    });

    shots.push({ start: round3(shotStart), end: round3(shotEnd), layers });

    // Scene caption: single-line chunks inside the scene window (semua chunk
    // selalu tampil — durasi dikompres bila jendela sempit).
    const maxChars = is916 ? (input.styleB === "B1" ? 44 : 36) : input.styleB === "B1" ? 50 : 44;
    const sceneCues = buildSingleLineCues(
      scene.narration,
      shotStart + (i === 0 ? lead : 0.15),
      shotEnd - 0.12,
      maxChars
    );
    captions.push(...sceneCues);
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
