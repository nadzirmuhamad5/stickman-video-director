import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const styleB = body.styleB === "B2" ? "B2" : "B1";
  const narrationLang = body.narrationLang === "en" ? "en" : "id";
  const requested = String(body.voice ?? "");
  const voice = findVoice(requested) ? requested : DEFAULT_VOICE;
  const ttsEngine = findVoice(voice)!.engine;

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
