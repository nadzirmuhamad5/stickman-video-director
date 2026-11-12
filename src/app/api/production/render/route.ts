import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { jobIdValid, jobDir } from "@/lib/production";
import { isJobRunning, renderJob } from "@/lib/production-runner";

export const runtime = "nodejs";
export const maxDuration = 600;
export const dynamic = "force-dynamic";

/** Manual render trigger — thin wrapper around the shared renderJob(). */
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
    return NextResponse.json(
      { error: "Produksi sedang berjalan di latar belakang. Pantau lewat status." },
      { status: 409 }
    );
  }

  try {
    const result = await renderJob(jobId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Render gagal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
