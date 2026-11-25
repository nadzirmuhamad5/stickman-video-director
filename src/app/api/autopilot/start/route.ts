import { NextRequest, NextResponse } from "next/server";
import { corsPreflight } from "@/lib/cors";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  jobDir,
  writeProgress,
} from "@/lib/production";
import { runAutopilotJob, type AutopilotJob } from "@/lib/autopilot-runner";
import { DEFAULT_VOICE, findVoice } from "@/lib/tts-voices";
import { readGeminiKey } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STYLE_B_ALLOWED = new Set(["B1", "B2", "B3", "B4"]);

/** Mode B · Autopilot: topic → finished video, fully server-side. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "Topik wajib diisi." }, { status: 400 });
  }
  if (topic.length > 4000) {
    return NextResponse.json({ error: "Topik terlalu panjang (maks 4000 karakter)." }, { status: 400 });
  }
  const ratio = body.ratio === "9:16" ? "9:16" : "16:9";
  const durationSeconds = Number(body.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 20 || durationSeconds > 300) {
    return NextResponse.json({ error: "Durasi autopilot 20–300 detik." }, { status: 400 });
  }
  const styleRaw = String(body.styleB ?? "B1");
  if (!STYLE_B_ALLOWED.has(styleRaw)) {
    return NextResponse.json({ error: "Gaya autopilot tidak dikenal (B1–B4)." }, { status: 400 });
  }
  const styleB = styleRaw as AutopilotJob["styleB"];
  const narrationLang = body.narrationLang === "en" ? "en" : "id";
  const requested = String(body.voice ?? "");
  const voice = findVoice(requested) ? requested : DEFAULT_VOICE;
  const ttsEngine = findVoice(voice)!.engine;

  // B4 menghasilkan ilustrasi full-scene lewat Gemini (dengan style-lock
  // reference bawaan) — tanpa key, pipeline tidak bisa memenuhi gaya terkunci.
  if (styleB === "B4" && !readGeminiKey()) {
    return NextResponse.json(
      {
        error:
          "Gaya B4 butuh Gemini API key untuk ilustrasi adegan. Pasang key di panel Status dulu, atau pakai B1–B3.",
      },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const dir = jobDir(id);
  ensureDir(path.join(dir, "canvas"));

  const job: AutopilotJob = {
    id,
    mode: "B",
    createdAt: new Date().toISOString(),
    topic,
    ratio,
    styleB,
    durationSeconds,
    narrationLang,
    voice,
    ttsEngine,
  };
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job));
  writeProgress(id, { stage: "assets", message: "Menyiapkan produksi autopilot…", clips: {} });

  // Pipeline berjalan di server (background); client hanya polling status.
  void runAutopilotJob(id);

  return NextResponse.json({ jobId: id });
}

export async function OPTIONS() {
  return corsPreflight();
}
