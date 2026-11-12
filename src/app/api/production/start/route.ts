import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  jobDir,
  writeProgress,
  type Proposal,
  type ProductionJob,
} from "@/lib/production";
import { runProductionJob } from "@/lib/production-runner";
import { DEFAULT_VOICE, findVoice } from "@/lib/tts-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const proposal = body.proposal as Proposal | undefined;
  if (!proposal || !Array.isArray(proposal.clips) || proposal.clips.length === 0) {
    return NextResponse.json({ error: "Proposal tidak valid." }, { status: 400 });
  }
  if (proposal.clips.length > 12) {
    return NextResponse.json({ error: "Maksimal 12 klip per produksi." }, { status: 400 });
  }
  const narrationLang = body.narrationLang === "en" ? "en" : "id";
  const requested = String(body.voice ?? "");
  const voice = findVoice(requested) ? requested : DEFAULT_VOICE;
  const ttsEngine = findVoice(voice)!.engine;

  const id = randomUUID();
  const dir = jobDir(id);
  ensureDir(path.join(dir, "assets"));
  ensureDir(path.join(dir, "captions"));

  const job: ProductionJob = {
    id,
    createdAt: new Date().toISOString(),
    narrationLang,
    voice,
    ttsEngine,
    proposal,
  };
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job));
  writeProgress(id, { stage: "assets", message: "Menyiapkan aset produksi…", clips: {} });

  // Production runs entirely on the server in the background. The client only
  // polls /api/production/status/[jobId], so refreshing or closing the tab
  // does not abort the pipeline anymore.
  void runProductionJob(id);

  return NextResponse.json({ jobId: id });
}
