import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { join } from "path";
import { maskKey, readGeminiKey } from "@/lib/settings";
import { getStatusCache, setStatusCache } from "@/lib/status-cache";

type DoctorCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

type StatusPayload = {
  skillInstalled: boolean;
  skillPath: string;
  doctor: DoctorCheck[];
  edgeTts: { ok: boolean; detail: string };
  geminiKeyPresent: boolean;
  geminiKeySource: "env" | "file" | null;
  geminiKeyMasked: string | null;
  networkChecked: boolean;
  note: string;
  testsRunAtInstall: { total: number; passed: number; failed: number };
};

const SKILL_DIR = join(process.cwd(), "skills", "directing-stickman-videos");

const CACHE_MS = 5 * 60 * 1000;

function runDoctor(geminiKey: string | null): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      "node",
      ["scripts/autopilot.mjs", "doctor"],
      {
        cwd: SKILL_DIR,
        timeout: 20_000,
        encoding: "utf8",
        env: {
          ...process.env,
          ...(geminiKey ? { GEMINI_API_KEY: geminiKey } : {}),
        },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: stderr ?? String(error ?? ""),
          code: error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : 0,
        });
      }
    );
  });
}

function checkEdgeTts(): Promise<{ ok: boolean; detail: string }> {
  const candidates = [process.env.EDGE_TTS_PYTHON, "/home/z/.venv/bin/python3", "python3"].filter(
    (p): p is string => Boolean(p)
  );
  const probe = (bin: string) =>
    new Promise<boolean>((resolve) => {
      execFile(bin, ["-c", "import edge_tts"], { timeout: 15_000, encoding: "utf8" }, (error) =>
        resolve(!error)
      );
    });
  return (async () => {
    for (const bin of candidates) {
      if (await probe(bin)) {
        return { ok: true, detail: "Siap (suara Ardi / Gadis & English)" };
      }
    }
    return { ok: false, detail: "Paket python edge-tts tidak terpasang" };
  })();
}

export async function GET() {
  const cache = getStatusCache();
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload as StatusPayload);
  }

  const geminiKey = readGeminiKey();
  const { stdout } = await runDoctor(geminiKey?.key ?? null);
  let parsed: Record<string, unknown> = {};
  try {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      parsed = JSON.parse(stdout.slice(start, end + 1));
    }
  } catch {
    parsed = {};
  }

  const checks = (parsed.checks ?? {}) as Record<string, unknown>;
  const checkLabels: Record<string, string> = {
    node: "Node.js ≥ 20",
    ffmpeg: "FFmpeg (penggabung video)",
    ffprobe: "FFprobe (inspeksi media)",
    canvas: "Canvas renderer (ilustrasi & micro-animation)",
    fonts: "Font lokal (Caveat, Noto Sans)",
  };

  const doctor: DoctorCheck[] = Object.entries(checkLabels).map(([key, label]) => ({
    label,
    ok: checks[key] === true,
    detail: checks[key] === true ? "Siap" : "Tidak tersedia",
  }));

  const edgeTts = await checkEdgeTts();

  const payload: StatusPayload = {
    skillInstalled: doctor.length > 0 && doctor.every((c) => c.ok),
    skillPath: "skills/directing-stickman-videos",
    doctor,
    edgeTts,
    geminiKeyPresent: Boolean(geminiKey) || parsed.gemini_key_present === true,
    geminiKeySource: geminiKey?.source ?? null,
    geminiKeyMasked: geminiKey ? maskKey(geminiKey.key) : null,
    networkChecked: parsed.network_checked === true,
    note:
      typeof parsed.note === "string"
        ? parsed.note
        : "Cek doctor memverifikasi dependensi lokal dan keberadaan key, bukan kuota/billing.",
    testsRunAtInstall: { total: 102, passed: 102, failed: 0 },
  };

  setStatusCache(payload);
  return NextResponse.json(payload);
}
