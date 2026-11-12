import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { jobIdValid, jobDir } from "@/lib/production";
import { generateClipAssets, isJobRunning } from "@/lib/production-runner";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Manual single-clip generation. The background runner uses the same shared
 * generateClipAssets(); while a background run is active this endpoint is
 * locked to avoid double work.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "");
  const index = Number(body.index);
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
    const result = await generateClipAssets(jobId, index);
    return NextResponse.json({ ok: true, index, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat aset klip.";
    console.error(`[production/clip] ${jobId} #${index}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
