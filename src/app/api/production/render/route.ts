import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  buildCues,
  buildSrt,
  CAPTION_FONT,
  computeTimings,
  drawTextEscaped,
  jobIdValid,
  jobDir,
  probeDuration,
  readJob,
  readProgress,
  runFfmpeg,
  writeProgress,
} from "@/lib/production";

export const runtime = "nodejs";
export const maxDuration = 600;
export const dynamic = "force-dynamic";

const PRE: Record<string, { w: number; h: number; out: { w: number; h: number } }> = {
  "16:9": { w: 1920, h: 1080, out: { w: 1280, h: 720 } },
  "9:16": { w: 1080, h: 1920, out: { w: 720, h: 1280 } },
};

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

  const job = readJob(jobId);
  const dir = jobDir(jobId);
  const assetsDir = path.join(dir, "assets");
  const captionsDir = path.join(dir, "captions");
  const clips = [...job.proposal.clips].sort((a, b) => a.index - b.index);

  // Verify every clip has its assets and measure narration durations.
  const audioDurations: number[] = [];
  for (const clip of clips) {
    const wav = path.join(assetsDir, `clip-${clip.index}.wav`);
    const png = path.join(assetsDir, `clip-${clip.index}.png`);
    if (!fs.existsSync(wav) || !fs.existsSync(png)) {
      return NextResponse.json(
        { error: `Aset klip ${clip.index} belum lengkap — buat semua aset dulu.` },
        { status: 409 }
      );
    }
    audioDurations.push(await probeDuration(wav));
  }

  const timings = computeTimings(audioDurations);
  const total = timings.reduce((a, t) => a + t.duration, 0);
  const plane = PRE[job.proposal.ratio === "9:16" ? "9:16" : "16:9"];
  const captionDark = job.proposal.styleCode !== "A3";
  const fontColor = captionDark ? "0x232323" : "0xFFFFFF";
  const borderColor = captionDark ? "white@0.9" : "black@0.85";

  writeProgress(jobId, {
    stage: "render",
    render: { message: "Merender segmen klip…", pct: 5 },
  });

  try {
    // ------------------------------------------------------------- segments
    const segFiles: string[] = [];
    const globalCues: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const timing = timings[i];
      const frames = Math.round(timing.duration * 24);
      const segPath = path.join(dir, `seg-${i}.mp4`);
      const narration =
        job.narrationLang === "en" ? clip.narrationEn : clip.narrationId;

      // Caption cues for this clip.
      const cues = buildCues(narration, timing.duration, job.proposal.ratio);
      for (const cue of cues) {
        globalCues.push({
          text: cue.text,
          start: timing.start + cue.start,
          end: timing.start + cue.end,
        });
      }

      const drawtexts: string[] = [];
      cues.forEach((cue, ci) => {
        const file = path.join(captionsDir, `c-${i}-${ci}.txt`);
        fs.writeFileSync(file, drawTextEscaped(cue.lines));
        drawtexts.push(
          `drawtext=fontfile=${CAPTION_FONT}:textfile=${file}` +
            `:fontsize=${job.proposal.ratio === "9:16" ? 34 : 34}:fontcolor=${fontColor}` +
            `:borderw=4:bordercolor=${borderColor}` +
            `:x=(w-text_w)/2:y=h-${job.proposal.ratio === "9:16" ? 190 : 150}` +
            `:line_spacing=8:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'`
        );
      });

      if (i === 0) {
        const titleFile = path.join(captionsDir, "title.txt");
        const maxChars = job.proposal.ratio === "9:16" ? 22 : 34;
        const words = job.proposal.title.split(/\s+/);
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
          const next = line ? `${line} ${w}` : w;
          if (next.length > maxChars && line) {
            lines.push(line);
            line = w;
          } else line = next;
        }
        if (line && lines.length < 3) lines.push(line);
        fs.writeFileSync(titleFile, lines.join("\n"));
        drawtexts.push(
          `drawtext=fontfile=${CAPTION_FONT}:textfile=${titleFile}` +
            `:fontsize=${job.proposal.ratio === "9:16" ? 46 : 52}:fontcolor=${fontColor}` +
            `:borderw=5:bordercolor=${borderColor}` +
            `:x=(w-text_w)/2:y=h*0.13:line_spacing=10` +
            `:alpha='min(1,max(0,min((t-0.3)/0.5,(3.6-t)/0.4)))'` +
            `:enable='between(t,0.3,3.7)'`
        );
      }

      const zoomExpr =
        i % 2 === 0
          ? `1+0.12*on/${frames - 1}`
          : `1.12-0.12*on/${frames - 1}`;

      const filter =
        `[0:v]scale=${plane.w}:${plane.h}:force_original_aspect_ratio=increase` +
        `,crop=${plane.w}:${plane.h}` +
        `,zoompan=z='${zoomExpr}'` +
        `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=1:s=${plane.out.w}x${plane.out.h}:fps=24` +
        `,fade=t=in:st=0:d=0.35,fade=t=out:st=${(timing.duration - 0.35).toFixed(2)}:d=0.35` +
        `,${drawtexts.join(",")}[vout]`;

      await runFfmpeg([
        "-framerate",
        "24",
        "-loop",
        "1",
        "-t",
        timing.duration.toFixed(3),
        "-i",
        path.join(assetsDir, `clip-${clip.index}.png`),
        "-filter_complex",
        filter,
        "-map",
        "[vout]",
        "-frames:v",
        String(frames),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        segPath,
      ]);
      segFiles.push(segPath);
      writeProgress(jobId, {
        stage: "render",
        render: {
          message: `Merender klip ${i + 1}/${clips.length}…`,
          pct: Math.round(10 + (70 * (i + 1)) / clips.length),
        },
      });
    }

    // ---------------------------------------------------------------- concat
    const listPath = path.join(dir, "concat.txt");
    fs.writeFileSync(listPath, segFiles.map((f) => `file '${f}'`).join("\n") + "\n");
    const silentPath = path.join(dir, "video-silent.mp4");
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", silentPath]);
    writeProgress(jobId, {
      stage: "render",
      render: { message: "Menggabungkan klip…", pct: 82 },
    });

    // ------------------------------------------------------------ audio mix
    const args: string[] = ["-i", silentPath];
    clips.forEach((c) => args.push("-i", path.join(assetsDir, `clip-${c.index}.wav`)));
    const delays: string[] = [];
    const mixes: string[] = [];
    timings.forEach((t, i) => {
      const ms = Math.round(t.start * 1000);
      delays.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
      mixes.push(`[a${i}]`);
    });
    const finalPath = path.join(dir, "final.mp4");
    args.push(
      "-filter_complex",
      `${delays.join(";")};${mixes.join("")}amix=inputs=${mixes.length}:normalize=0:duration=longest` +
        `,apad,atrim=0:${total.toFixed(3)},alimiter=limit=0.95[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      finalPath
    );
    await runFfmpeg(args);

    // ---------------------------------------------------------- poster + srt
    writeProgress(jobId, { stage: "render", render: { message: "Membuat poster & subtitle…", pct: 94 } });
    const posterPath = path.join(dir, "poster.jpg");
    await runFfmpeg(["-ss", "1.4", "-i", finalPath, "-frames:v", "1", "-q:v", "3", posterPath]);
    fs.writeFileSync(path.join(dir, "captions.srt"), buildSrt(globalCues));

    writeProgress(jobId, {
      stage: "done",
      render: { message: "Selesai", pct: 100 },
      totalDuration: total,
    });

    return NextResponse.json({
      ok: true,
      duration: Number(total.toFixed(2)),
      videoUrl: `/api/media/${jobId}/final.mp4`,
      posterUrl: `/api/media/${jobId}/poster.jpg`,
      srtUrl: `/api/media/${jobId}/captions.srt`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan render tidak diketahui";
    console.error(`[production/render] failed: ${message}`);
    writeProgress(jobId, { stage: "error", message: `Render gagal: ${message}` });
    return NextResponse.json({ error: `Render gagal: ${message}` }, { status: 500 });
  }
}
