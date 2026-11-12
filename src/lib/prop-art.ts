import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import ZAI from "z-ai-web-dev-sdk";

// ---------------------------------------------------------------------------
// Topic-driven prop illustrations for the canvas renderer (styles B1/B2).
//
// The bundled @b1 crayon assets are all content-creator themed, so most
// topics ended up with a bare stickman. Instead, each beat now names a
// concrete object from the narration ("gurita", "jantung", "roket", …) and
// this module generates a matching hand-drawn prop illustration:
//   ZAI image gen (no key needed; Gemini image is used for B4 scenes) →
//   scripts/prop-tools.mjs whiten-alpha (white → transparency) → PNG cache.
//
// Results are cached globally under data/prop-cache/<sha>.png keyed by
// (style, hint) so repeated topics do not regenerate anything.
// ---------------------------------------------------------------------------

export type PropStyle = "B1" | "B2";

const CACHE_DIR = path.join(process.cwd(), "data", "prop-cache");
const PROP_PROMPTS: Record<PropStyle, string> = {
  B1: "Simple hand-drawn crayon doodle of {hint}, thick dark charcoal outline sketch, minimal warm orange accent color, childlike rough crayon texture, single centered object filling most of the frame, pure white background, no text, no letters, no watermark, no background scenery",
  B2: "Simple hand-drawn crayon doodle of {hint}, thick dark brown outline sketch, cheerful warm coloring, childlike rough crayon texture, single centered object filling most of the frame, pure white background, no text, no letters, no watermark, no background scenery",
};

const MAX_PROP_CHARS = 60;

/** "Gurita raksasa!!" → "gurita raksasa" (amankan sebagai nama objek). */
export function sanitizePropHint(raw: string): string {
  const clean = raw
    .replace(/["“”'’]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROP_CHARS);
  return clean;
}

function cachePath(style: PropStyle, hint: string): string {
  const key = crypto.createHash("sha256").update(`${style}:${hint.toLowerCase()}`).digest("hex").slice(0, 24);
  return path.join(CACHE_DIR, `${key}.png`);
}

function runPropTools(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(process.cwd(), "scripts", "prop-tools.mjs"), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `prop-tools exit ${code}`))));
  });
}

async function generateViaZai(hint: string, style: PropStyle): Promise<Buffer> {
  const zai = await ZAI.create();
  const response = await zai.images.generations.create({
    prompt: PROP_PROMPTS[style].replace("{hint}", hint),
    size: "1024x1024",
  });
  const b64 = response?.data?.[0]?.base64;
  if (!b64) throw new Error("Generator gambar tidak mengembalikan data");
  return Buffer.from(b64, "base64");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Generate (or fetch from cache) a transparent-background prop illustration
 * for `hint`. Returns the PNG path, or null when generation fails — callers
 * fall back to bundled @b1 assets or "none".
 */
export async function ensurePropImage(hint: string, style: PropStyle): Promise<string | null> {
  const clean = sanitizePropHint(hint);
  if (!clean) return null;
  const cached = cachePath(style, clean);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 1000) return cached;

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmpRaw = path.join(CACHE_DIR, `.raw-${process.pid}-${Date.now()}.jpg`);
  try {
    // 429 (rate limit) dicoba lagi dengan jeda membesar — generator gambar
    // dibatasi per menit, dan beberapa job bisa berjalan bersamaan.
    let bytes: Buffer | null = null;
    let lastErr = "unknown";
    for (let attempt = 1; attempt <= 3 && !bytes; attempt++) {
      try {
        bytes = await generateViaZai(clean, style);
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (/429|Too many/i.test(lastErr) && attempt < 3) {
          await sleep(12000 * attempt);
          continue;
        }
        throw err;
      }
    }
    if (!bytes) throw new Error(lastErr);
    fs.writeFileSync(tmpRaw, bytes);
    await runPropTools(["whiten-alpha", tmpRaw, cached]);
    if (!fs.existsSync(cached) || fs.statSync(cached).size < 1000) throw new Error("Hasil alpha kosong");
    return cached;
  } catch (err) {
    console.error(`[prop-art] '${clean}' gagal: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    try {
      fs.rmSync(tmpRaw, { force: true });
    } catch {
      // abaikan
    }
  }
}

/**
 * Generate props for a list of hints with bounded concurrency. Returns a
 * map hint → absolute PNG path (only hints that succeeded).
 */
export async function ensurePropImages(
  hints: string[],
  style: PropStyle,
  opts: { concurrency?: number; max?: number; spacingMs?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<Map<string, string>> {
  const unique = [...new Set(hints.map((h) => sanitizePropHint(h)).filter(Boolean))].slice(0, opts.max ?? 12);
  const out = new Map<string, string>();
  let done = 0;
  const queue = [...unique];
  const spacing = opts.spacingMs ?? 4000;
  // Satu worker + jeda antar-permintaan: kuota generator gambar dibatasi
  // per menit, burst paralel langsung kena 429.
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 1, queue.length)) }, async () => {
    while (queue.length) {
      const hint = queue.shift()!;
      const p = await ensurePropImage(hint, style);
      done += 1;
      opts.onProgress?.(done, unique.length);
      if (p) out.set(hint, p);
      if (queue.length && spacing > 0) await sleep(spacing);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Copy generated props into the job's canvas dir and return relative layer
 * paths (the renderer resolves them against the project dir).
 */
export function stagePropsIntoCanvasDir(
  canvasDir: string,
  generated: Map<string, string>
): Map<string, string> {
  const propsDir = path.join(canvasDir, "props");
  fs.mkdirSync(propsDir, { recursive: true });
  const staged = new Map<string, string>();
  let i = 0;
  for (const [hint, abs] of generated) {
    const rel = `props/p${i++}.png`;
    fs.copyFileSync(abs, path.join(canvasDir, rel));
    staged.set(hint, rel);
  }
  return staged;
}
