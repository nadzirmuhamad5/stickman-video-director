import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { jobDir, jobIdValid } from "@/lib/production";
import { isJobRunning, runProductionJob } from "@/lib/production-runner";
import { runAutopilotJob } from "@/lib/autopilot-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resume an existing job (Mode A or B): continues generating any missing
 * assets, then renders. Completed assets are reused, so this is cheap after
 * an error or a server restart.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "");
  if (!jobIdValid(jobId) || !fs.existsSync(path.join(jobDir(jobId), "job.json"))) {
    return NextResponse.json({ error: "Job produksi tidak ditemukan." }, { status: 404 });
  }
  if (isJobRunning(jobId)) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  const raw = JSON.parse(fs.readFileSync(path.join(jobDir(jobId), "job.json"), "utf8")) as { mode?: string };
  if (raw.mode === "B") {
    void runAutopilotJob(jobId);
  } else {
    void runProductionJob(jobId);
  }
  return NextResponse.json({ ok: true, alreadyRunning: false });
}
