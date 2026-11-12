import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ZAI from "z-ai-web-dev-sdk";
import { runFfmpeg, sleep } from "@/lib/production";
import { resolveVoice } from "@/lib/tts-voices";

// ---------------------------------------------------------------------------
// TTS synthesis (server-only). Voice catalog: src/lib/tts-voices.ts.
//
//  - "edge": Microsoft Edge neural TTS (via the local `edge-tts` Python
//    package) — native Indonesian voices, transcoded to PCM wav afterwards.
//  - "zai" : the bundled z-ai-web-dev-sdk voices (writes wav directly).
// ---------------------------------------------------------------------------

export type SynthesizeOptions = {
  text: string;
  voiceId: string;
  /** final output path; always written as 44.1 kHz stereo PCM wav */
  outPath: string;
};

/**
 * Synthesize narration to `outPath` (wav). Throws on failure — callers own
 * the retry policy.
 */
export async function synthesizeTTS({ text, voiceId, outPath }: SynthesizeOptions): Promise<void> {
  const voice = resolveVoice(voiceId);
  if (voice.engine === "edge") {
    await synthesizeEdge(text, voice.id, outPath);
  } else {
    await synthesizeZai(text, voice.id, outPath);
  }
}

// --- Edge -------------------------------------------------------------------

function runCapture(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timeout`));
    }, timeoutMs);
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-1500)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${bin} exit ${code}`));
    });
  });
}

const PYTHON_CANDIDATES = [
  process.env.EDGE_TTS_PYTHON,
  "/home/z/.venv/bin/python3",
  "python3",
].filter((p): p is string => Boolean(p));

let pythonBinCache: string | null = null;

/**
 * Find a python interpreter that actually has the `edge_tts` package.
 * The Next.js server may run with a PATH that misses the venv, so probe
 * explicit candidates and cache the first that works.
 */
async function edgePythonBin(): Promise<string> {
  if (pythonBinCache) return pythonBinCache;
  const errors: string[] = [];
  for (const bin of PYTHON_CANDIDATES) {
    try {
      await runCapture(bin, ["-c", "import edge_tts"], 20_000);
      pythonBinCache = bin;
      return bin;
    } catch (err) {
      errors.push(`${bin}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  throw new Error(
    `Tidak ada Python dengan paket edge-tts (coba: ${PYTHON_CANDIDATES.join(", ")}) — ${errors.join(" | ")}`
  );
}

async function synthesizeEdge(text: string, voiceId: string, outPath: string): Promise<void> {
  const tmp = path.join(os.tmpdir(), `edge-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  try {
    const py = await edgePythonBin();
    // <py> -m edge_tts --voice X --text ... --write-media out.mp3
    await runCapture(py, ["-m", "edge_tts", "--voice", voiceId, "--text", text, "--write-media", tmp], 120_000);
    const stat = fs.statSync(tmp);
    if (stat.size < 2000) throw new Error("Audio Edge TTS terlalu pendek / kosong");
    // Transcode to a consistent PCM wav for the render pipeline.
    await runFfmpeg(["-i", tmp, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outPath]);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

// --- z-ai -------------------------------------------------------------------

async function synthesizeZai(text: string, voiceId: string, outPath: string): Promise<void> {
  let lastError = "Unknown TTS error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const zai = await ZAI.create();
      const response = await zai.audio.tts.create({
        input: text.slice(0, 1000),
        voice: voiceId,
        speed: 1.0,
        response_format: "wav",
        stream: false,
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      if (buffer.length < 2000) throw new Error("Audio TTS terlalu pendek / kosong");
      fs.writeFileSync(outPath, buffer);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(900 * attempt);
    }
  }
  throw new Error(lastError);
}

// --- Preview (audition) -----------------------------------------------------

export type PreviewRequest = { voiceId: string; lang: "id" | "en"; text?: string };

const PREVIEW_TEXTS: Record<"id" | "en", string> = {
  id: "Halo! Beginilah suara saya sebagai narator video Anda. Setiap klip akan dinarasikan dengan ritme yang jelas dan mudah diikuti.",
  en: "Hi! This is how my voice will narrate your video. Every clip gets a clear, easy-to-follow rhythm.",
};

const PREVIEW_DIR = path.join(process.cwd(), "production", "_tts-preview");

/**
 * Return preview audio for a voice. Results are cached on disk so repeated
 * auditions cost nothing.
 */
export async function getVoicePreview(req: PreviewRequest): Promise<{ buffer: Buffer; contentType: string }> {
  const voice = resolveVoice(req.voiceId);
  const text = (req.text ?? PREVIEW_TEXTS[req.lang === "en" ? "en" : "id"]).slice(0, 300);
  const isEdge = voice.engine === "edge";
  const ext = isEdge ? "mp3" : "wav";
  const file = path.join(PREVIEW_DIR, `${voice.engine}-${voice.id}-${hashString(text)}.${ext}`);

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  if (!fs.existsSync(file) || fs.statSync(file).size < 2000) {
    if (isEdge) {
      await synthesizeEdgePreview(text, voice.id, file);
    } else {
      const tmpWav = `${file}.wav`;
      await synthesizeZai(text, voice.id, tmpWav);
      fs.renameSync(tmpWav, file);
    }
  }
  return { buffer: fs.readFileSync(file), contentType: isEdge ? "audio/mpeg" : "audio/wav" };
}

async function synthesizeEdgePreview(text: string, voiceId: string, outPath: string): Promise<void> {
  let lastError = "Unknown edge-tts error";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const tmp = path.join(os.tmpdir(), `edge-tts-pv-${Date.now()}-${attempt}.mp3`);
      try {
        const py = await edgePythonBin();
        await runCapture(py, ["-m", "edge_tts", "--voice", voiceId, "--text", text, "--write-media", tmp], 60_000);
        if (fs.statSync(tmp).size < 2000) throw new Error("Audio kosong");
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.copyFileSync(tmp, outPath);
        return;
      } finally {
        if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(600 * attempt);
    }
  }
  throw new Error(lastError);
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
