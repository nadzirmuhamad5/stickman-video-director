import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { jobIdValid, jobDir, readProgress } from "@/lib/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  if (!jobIdValid(jobId) || !fs.existsSync(path.join(jobDir(jobId), "job.json"))) {
    return NextResponse.json({ error: "Job tidak ditemukan." }, { status: 404 });
  }
  const progress = readProgress(jobId);
  const done = fs.existsSync(path.join(jobDir(jobId), "final.mp4"));
  return NextResponse.json({ jobId, progress, done });
}
