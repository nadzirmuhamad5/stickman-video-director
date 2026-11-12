import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// App settings (server-only). Currently holds the optional Gemini API key
// used by the skill's Autopilot pipeline (gemini-media.mjs).
//
// Resolution order: process.env.GEMINI_API_KEY first (set via .env / shell),
// then the web-managed settings file written through the Settings UI.
// The raw key is NEVER returned by any API — only a masked preview.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

type SettingsFile = {
  geminiApiKey?: string;
  updatedAt?: string;
};

export type GeminiKeySource = "env" | "file" | null;

function readSettingsFile(): SettingsFile {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as SettingsFile;
  } catch {
    return {};
  }
}

/** The effective Gemini key: env wins, then the web-managed file. */
export function readGeminiKey(): { key: string; source: Exclude<GeminiKeySource, null> } | null {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return { key: envKey, source: "env" };
  const fileKey = readSettingsFile().geminiApiKey?.trim();
  if (fileKey) return { key: fileKey, source: "file" };
  return null;
}

/**
 * Persist the Gemini key in data/settings.json (permissions 0600).
 * Throws on invalid input.
 */
export function saveGeminiKey(rawKey: string): { masked: string; warning?: string } {
  const key = rawKey
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");

  if (!key) throw new Error("Key tidak boleh kosong.");
  if (/\s/.test(key)) throw new Error("Key tidak boleh mengandung spasi.");
  if (key.length < 20) throw new Error("Key terlalu pendek — Gemini API key biasanya ±39 karakter.");

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const next: SettingsFile = { ...readSettingsFile(), geminiApiKey: key, updatedAt: new Date().toISOString() };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });

  return {
    masked: maskKey(key),
    warning: key.startsWith("AIza") ? undefined : "Format tidak biasa — key Gemini umumnya diawali \"AIza\". Tetap disimpan.",
  };
}

/** Remove the web-managed key. Returns false when nothing was stored. */
export function clearGeminiKey(): boolean {
  const current = readSettingsFile();
  if (!current.geminiApiKey) return false;
  const next: SettingsFile = { ...current };
  delete next.geminiApiKey;
  next.updatedAt = new Date().toISOString();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return true;
}

/** Short safe preview, e.g. "AIzaSy…f2kQ". */
export function maskKey(key: string): string {
  if (key.length <= 10) return "••••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
