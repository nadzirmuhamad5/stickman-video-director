import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { jobIdValid, PRODUCTION_DIR } from "@/lib/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".srt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

const ALLOWED_TOP = new Set(["final.mp4", "poster.jpg", "captions.srt"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; file: string[] }> }
) {
  const { jobId, file } = await params;
  if (!jobIdValid(jobId)) {
    return NextResponse.json({ error: "Job tidak valid." }, { status: 400 });
  }

  const segs = file.map((s) => String(s));
  let rel: string;
  if (segs[0] === "assets" && segs.length === 2 && /^clip-\d+\.(png|wav)$/.test(segs[1])) {
    rel = path.join("assets", segs[1]);
  } else if (segs.length === 1 && ALLOWED_TOP.has(segs[0])) {
    rel = segs[0];
  } else {
    return NextResponse.json({ error: "File tidak diizinkan." }, { status: 403 });
  }

  const jobRoot = path.join(PRODUCTION_DIR, jobId);
  const fullPath = path.join(jobRoot, rel);
  if (!fullPath.startsWith(jobRoot + path.sep) || !fs.existsSync(fullPath)) {
    return NextResponse.json({ error: "File tidak ditemukan." }, { status: 404 });
  }

  const stat = fs.statSync(fullPath);
  const type = MIME[path.extname(fullPath).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (request.nextUrl.searchParams.get("download") === "1") {
    const ext = path.extname(fullPath);
    const name =
      ext === ".mp4" ? "stickman-video.mp4" : ext === ".srt" ? "stickman-subtitle.srt" : path.basename(fullPath);
    headers["Content-Disposition"] = `attachment; filename="${name}"`;
  }

  const range = request.headers.get("range");
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        const buffer = Buffer.alloc(end - start + 1);
        const fd = fs.openSync(fullPath, "r");
        fs.readSync(fd, buffer, 0, buffer.length, start);
        fs.closeSync(fd);
        return new NextResponse(new Uint8Array(buffer), {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Content-Length": String(buffer.length),
          },
        });
      }
    }
  }

  const buffer = fs.readFileSync(fullPath);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}
