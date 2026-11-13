import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { PRODUCTION_DIR } from "@/lib/production";

// ---------------------------------------------------------------------------
// Vault: mirror git-tracked dari produksi yang selesai.
//
// Lingkungan eksekusi dapat di-recycle kapan saja dan hanya file yang sudah
// di-commit ke git yang bertahan. Tanpa vault, riwayat produksi (SQLite di
// db/) dan file video (production/) ikut terhapus setiap recycle.
//
// Alur:
//  - persistToVault(jobId): dipanggil saat job selesai — menyalin final.mp4,
//    poster.jpg, captions.srt, job.json + baris DB ke vault/.
//  - ensureVaultRestored(): dipanggil lazy oleh route API — mengisi ulang DB
//    dan production/ dari vault saat proses server baru mulai.
//
// vault/ TIDAK berisi rahasia (kunci API tetap di data/settings.json yang
// di-gitignore). Semua fungsi fail-soft: kegagalan vault tak boleh merusak
// render maupun API.
// ---------------------------------------------------------------------------

export const VAULT_DIR = path.join(process.cwd(), "vault");
const VAULT_INDEX_PATH = path.join(VAULT_DIR, "index.json");
const VAULT_FILES = ["job.json", "final.mp4", "poster.jpg", "captions.srt"] as const;

export type VaultRow = {
  id: string;
  jobId: string;
  mode: string;
  title: string;
  topic: string | null;
  ratio: string;
  styleCode: string;
  styleName: string | null;
  voice: string;
  narrationLang: string;
  status: string;
  stage: string;
  proposalJson: string | null;
  resultJson: string | null;
  durationSec: number | null;
  createdAt: string;
  updatedAt: string;
};

function readVaultIndex(): VaultRow[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(VAULT_INDEX_PATH, "utf8")) as VaultRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeVaultIndex(rows: VaultRow[]): void {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_INDEX_PATH, JSON.stringify(rows, null, 2));
}

/** Salin hasil job yang selesai (Mode A/B) ke vault. Panggil setelah recordJobDone. */
export async function persistToVault(jobId: string): Promise<void> {
  try {
    const row = await db.production.findUnique({ where: { jobId } });
    if (!row || row.status !== "done") return;

    const src = path.join(PRODUCTION_DIR, jobId);
    const dst = path.join(VAULT_DIR, jobId);
    fs.mkdirSync(dst, { recursive: true });
    for (const name of VAULT_FILES) {
      const file = path.join(src, name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dst, name));
    }

    const rows = readVaultIndex().filter((r) => r.jobId !== jobId);
    rows.unshift({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    writeVaultIndex(rows);
  } catch (err) {
    console.error("[vault] persist gagal:", err instanceof Error ? err.message : err);
  }
}

async function restoreFromVault(): Promise<void> {
  const entries = readVaultIndex();
  if (entries.length === 0) return;

  for (const entry of entries) {
    // 1) Baris DB — isi ulang bila hilang (server proses baru / DB kosong).
    try {
      const existing = await db.production.findUnique({ where: { jobId: entry.jobId } });
      if (!existing) {
        await db.production.create({
          data: {
            ...entry,
            createdAt: new Date(entry.createdAt),
            updatedAt: new Date(entry.updatedAt),
          },
        });
        console.log(`[vault] baris dipulihkan: ${entry.jobId} (${entry.title})`);
      }
    } catch (err) {
      console.error("[vault] restore baris gagal:", err instanceof Error ? err.message : err);
    }

    // 2) File output — salin balik ke production/ bila hilang.
    try {
      const jobDir = path.join(PRODUCTION_DIR, entry.jobId);
      if (!fs.existsSync(path.join(jobDir, "final.mp4"))) {
        fs.mkdirSync(jobDir, { recursive: true });
        for (const name of VAULT_FILES) {
          const file = path.join(VAULT_DIR, entry.jobId, name);
          if (fs.existsSync(file)) fs.copyFileSync(file, path.join(jobDir, name));
        }
        console.log(`[vault] file dipulihkan: ${entry.jobId}`);
      }
    } catch (err) {
      console.error("[vault] restore file gagal:", err instanceof Error ? err.message : err);
    }
  }
}

let restorePromise: Promise<void> | null = null;

/** Lazy restore sekali per proses server — dipanggil route API riwayat. */
export function ensureVaultRestored(): Promise<void> {
  restorePromise ??= restoreFromVault().catch((err) => {
    console.error("[vault] restore gagal:", err instanceof Error ? err.message : err);
  });
  return restorePromise;
}
