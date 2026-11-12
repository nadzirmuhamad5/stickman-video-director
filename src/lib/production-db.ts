import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Persistence hooks: every production job (Mode A & B) is stored in SQLite so
// results survive page refreshes and appear in the history list.
// All functions fail soft — a DB hiccup must never break a render.
// ---------------------------------------------------------------------------

export type JobRecordInput = {
  jobId: string;
  mode: "A" | "B";
  title: string;
  topic?: string | null;
  ratio: string;
  styleCode: string;
  styleName?: string | null;
  voice: string;
  narrationLang: string;
  proposalJson?: string | null;
};

export async function recordJobStart(input: JobRecordInput): Promise<void> {
  try {
    await db.production.upsert({
      where: { jobId: input.jobId },
      create: { ...input, status: "running", stage: "assets" },
      update: { status: "running", stage: "assets", title: input.title },
    });
  } catch (err) {
    console.error("[db] recordJobStart gagal:", err instanceof Error ? err.message : err);
  }
}

export async function recordJobStage(jobId: string, stage: string): Promise<void> {
  try {
    await db.production.updateMany({ where: { jobId }, data: { stage } });
  } catch (err) {
    console.error("[db] recordJobStage gagal:", err instanceof Error ? err.message : err);
  }
}

export async function recordJobDone(
  jobId: string,
  result: { duration: number; videoUrl: string; posterUrl: string; srtUrl: string }
): Promise<void> {
  try {
    await db.production.updateMany({
      where: { jobId },
      data: {
        status: "done",
        stage: "done",
        durationSec: result.duration,
        resultJson: JSON.stringify(result),
      },
    });
  } catch (err) {
    console.error("[db] recordJobDone gagal:", err instanceof Error ? err.message : err);
  }
}

export async function recordJobError(jobId: string, message: string): Promise<void> {
  try {
    await db.production.updateMany({
      where: { jobId },
      data: { status: "error", stage: "error", resultJson: JSON.stringify({ error: message }) },
    });
  } catch (err) {
    console.error("[db] recordJobError gagal:", err instanceof Error ? err.message : err);
  }
}
