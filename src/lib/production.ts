import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Production engine: turns an approved proposal into a fully rendered MP4
// (AI illustration per clip + TTS narration + Ken Burns motion + burned-in
// captions + audio mix), entirely on the server.
// ---------------------------------------------------------------------------

export const PRODUCTION_DIR = path.join(process.cwd(), "production");
export const FFMPEG_BIN = "ffmpeg";
export const FFPROBE_BIN = "ffprobe";
export const CAPTION_FONT = path.join(
  process.cwd(),
  "skills",
  "directing-stickman-videos",
  "assets",
  "fonts",
  "NotoSans.ttf"
);
export const FPS = 24;

export type ProposalClip = {
  index: number;
  stage: string;
  time: string;
  narrationEn: string;
  narrationId: string;
  beats: string[];
  devices: string[];
  transition: string;
};

export type Proposal = {
  title: string;
  logline: string;
  ratio: string;
  durationSeconds: number;
  styleCode: string;
  styleName: string;
  voiceProfile: string;
  bgm: string;
  clips: ProposalClip[];
};

export type JobClipProgress = {
  image?: boolean;
  audio?: boolean;
  audioDuration?: number;
  illustration?: string;
};

export type JobProgress = {
  stage: "assets" | "render" | "done" | "error";
  message?: string;
  clips: Record<number, JobClipProgress>;
  render?: { message: string; pct: number };
  totalDuration?: number;
  updatedAt: string;
};

export type ProductionJob = {
  id: string;
  createdAt: string;
  narrationLang: "id" | "en";
  voice: string;
  proposal: Proposal;
};

// --- Style prompt bases (aligned with the skill's visual grammar) ----------

const STYLE_IMAGE_BASE: Record<string, string> = {
  A1: "minimal hand-drawn stickman animation frame, pure black stick figures with simple expressive round heads, thin ink lines, clean flat white background, one restrained bright accent color reserved for the key idea, generous negative space, flat no shading, storyboard still frame",
  A2: "modern tech studio cartoon illustration, stickman character wearing a red hoodie over a yellow shirt, clean bright studio backdrop with subtle holographic UI panels floating around, soft gradients, cinematic lighting, storyboard still frame",
  A3: "prehistoric cave cartoon illustration, expressive white cartoon head with simple black stick limbs, animal fur costume, earthy stone-age cave setting with warm firelight, comedic exaggeration, storyboard still frame",
  A4: "warm cozy 2D cartoon illustration, full color, soft rounded shapes, gentle warm lighting, inviting storybook everyday-life scene, cheerful atmosphere, storyboard still frame",
  A5: "historical cel-shaded cartoon illustration, expressive white-faced character with short neck in period clothing, flat colors with comic shading, era-accurate background props, storyboard still frame",
};

export function styleImageBase(styleCode: string): string {
  return (
    STYLE_IMAGE_BASE[styleCode] ??
    "minimal hand-drawn stickman animation frame, black stick figures with expressive round heads, thin ink lines, flat background, storyboard still frame"
  );
}

export function buildScenePrompt(proposal: Proposal, clip: ProposalClip): string {
  const devices = clip.devices.slice(0, 6).join("; ");
  const scene = clip.narrationEn.replace(/["']/g, "").trim();
  const parts = [
    `Single illustration for one shot of an animated explainer video.`,
    `Scene: ${scene}.`,
    devices ? `Must include these visual elements: ${devices}.` : "",
    `Visual style: ${styleImageBase(proposal.styleCode)}.`,
    `Aspect ratio ${proposal.ratio}.`,
    `Absolutely no text, no letters, no captions, no speech bubbles, no watermark, no logo.`,
  ];
  return parts.filter(Boolean).join(" ");
}

// --- Job storage ------------------------------------------------------------

export function jobIdValid(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{5,40}$/.test(id);
}

export function jobDir(jobId: string): string {
  return path.join(PRODUCTION_DIR, jobId);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJob(jobId: string): ProductionJob {
  const file = path.join(jobDir(jobId), "job.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as ProductionJob;
}

export function readProgress(jobId: string): JobProgress {
  const file = path.join(jobDir(jobId), "progress.json");
  if (!fs.existsSync(file)) {
    return { stage: "assets", clips: {}, updatedAt: new Date().toISOString() };
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as JobProgress;
}

export function writeProgress(jobId: string, patch: Partial<JobProgress>): JobProgress {
  const current = readProgress(jobId);
  const next: JobProgress = {
    ...current,
    ...patch,
    clips: { ...current.clips, ...(patch.clips ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(jobDir(jobId), "progress.json"), JSON.stringify(next));
  return next;
}

// --- Media helpers ----------------------------------------------------------

export async function probeDuration(file: string): Promise<number> {
  const out = await runCapture(FFPROBE_BIN, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const value = Number(out.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Tidak bisa membaca durasi audio: ${path.basename(file)}`);
  }
  return value;
}

export function runCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b.slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `${bin} exit ${code}`))));
  });
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2400)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exit ${code}`))));
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Caption building -------------------------------------------------------

type Cue = { text: string; start: number; end: number; lines: string[] };

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Split narration into caption cues that fit the frame, timed proportionally
 * over the clip duration.
 */
export function buildCues(narration: string, clipDuration: number, ratio: string): Cue[] {
  const maxChars = ratio === "9:16" ? 26 : 40;
  const maxLines = ratio === "9:16" ? 2 : 2;
  const words = narration.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

  // Group words into chunks that render in <= maxLines lines.
  const chunks: string[] = [];
  let buffer: string[] = [];
  const lineCount = (ws: string[]) => wrapLines(ws.join(" "), maxChars).length;
  for (const w of words) {
    buffer.push(w);
    if (lineCount(buffer) > maxLines) {
      buffer.pop();
      if (buffer.length) chunks.push(buffer.join(" "));
      buffer = [w];
    }
  }
  if (buffer.length) chunks.push(buffer.join(" "));

  // Timings proportional to chunk length.
  const lead = 0.45; // narration audio starts slightly after the cut
  const total = Math.max(1, clipDuration - lead - 0.5);
  const weights = chunks.map((c) => Math.max(4, c.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let t = lead;
  return chunks.map((text, i) => {
    const dur = Math.max(0.9, (weights[i] / weightSum) * total);
    const cue: Cue = { text, start: t, end: Math.min(clipDuration - 0.15, t + dur), lines: wrapLines(text, maxChars) };
    t += dur;
    return cue;
  });
}

export function drawTextEscaped(lines: string[]): string {
  // Written through textfile=, so only newlines matter.
  return lines.join("\n");
}

function srtStamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  const f = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${f}`;
}

export function buildSrt(cues: { text: string; start: number; end: number }[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtStamp(c.start)} --> ${srtStamp(c.end)}\n${c.text}\n`)
      .join("\n") + "\n"
  );
}

// --- Timeline ---------------------------------------------------------------

export type ClipTiming = { index: number; audioDuration: number; duration: number; start: number };

export function computeTimings(audioDurations: number[]): ClipTiming[] {
  const timings: ClipTiming[] = [];
  let start = 0;
  audioDurations.forEach((audioDuration, i) => {
    const duration = Math.min(12.5, Math.max(4, audioDuration + 1.15));
    timings.push({ index: i, audioDuration, duration, start });
    start += duration;
  });
  return timings;
}
