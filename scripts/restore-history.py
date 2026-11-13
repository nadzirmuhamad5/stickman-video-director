#!/usr/bin/env python3
"""Restore recoverable production history from /tmp/my-project snapshot.

Environment recycle keeps only git-committed files; db/ and production/ were
wiped. /tmp/my-project (snapshot from Nov 12 23:46) still holds two Mode A
jobs: one complete (0b78b6eb, final.mp4) and one interrupted at assets stage
(71e10907). This script copies their outputs back and re-inserts DB rows.
"""
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

SRC = Path("/tmp/my-project/production")
DST = Path("/home/z/my-project/production")
DB = Path("/home/z/my-project/db/custom.db")

STYLE_NAME = "Hitam Putih Klasik (Klasik Minimalis)"
RESTORED_NOTE = "Dipulihkan otomatis setelah lingkungan di-restart."


def probe_duration(mp4: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(mp4)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        return round(float(out), 1)
    except Exception as exc:
        print(f"  ffprobe gagal: {exc}")
        return None


def make_poster(mp4: Path, poster: Path) -> None:
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", "1.4", "-i", str(mp4), "-frames:v", "1",
             "-q:v", "3", str(poster)],
            capture_output=True, timeout=60, check=True,
        )
        print(f"  poster.jpg dibuat ({poster.stat().st_size} bytes)")
    except Exception as exc:
        print(f"  poster gagal: {exc}")


def copy_job(job_id: str) -> Path:
    src = SRC / job_id
    dst = DST / job_id
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    print(f"  files -> {dst}")
    return dst


def insert_row(cur, row: dict) -> None:
    cols = [r[1] for r in cur.execute("PRAGMA table_info(Production)").fetchall()]
    fields, values = [], []
    for key, val in row.items():
        if key in cols:
            fields.append(key)
            values.append(val)
    cur.execute(
        f'INSERT OR REPLACE INTO Production ({", ".join(fields)}) '
        f'VALUES ({", ".join("?" for _ in fields)})',
        values,
    )


def main() -> None:
    complete_jobs, partial_jobs = [], []
    for job_dir in sorted(SRC.iterdir()):
        if not job_dir.is_dir() or job_dir.name.startswith("_"):
            continue
        job_id = job_dir.name
        try:
            spec = json.loads((job_dir / "job.json").read_text())
        except Exception as exc:
            print(f"[skip] {job_id[:8]}: job.json tidak terbaca ({exc})")
            continue
        proposal = spec.get("proposal") or {}
        title = proposal.get("title")
        if not title:
            print(f"[skip] {job_id[:8]}: tanpa judul")
            continue
        print(f"[restore] {job_id[:8]}: {title}")
        copy_job(job_id)

        result = {
            "videoUrl": f"/api/media/{job_id}/final.mp4",
            "posterUrl": f"/api/media/{job_id}/poster.jpg",
            "srtUrl": f"/api/media/{job_id}/captions.srt",
        }
        has_video = (job_dir / "final.mp4").exists()
        if has_video:
            dst_mp4 = DST / job_id / "final.mp4"
            dur = probe_duration(dst_mp4)
            if dur:
                result["duration"] = dur
            poster = DST / job_id / "poster.jpg"
            if not poster.exists():
                make_poster(dst_mp4, poster)
            result["restored"] = True
            status, stage = "done", "done"
            complete_jobs.append(job_id)
        else:
            result = {"error": f"{RESTORED_NOTE} Job terputus saat menyiapkan aset; silakan jalankan ulang."}
            status, stage = "error", "assets"
            partial_jobs.append(job_id)

        row = {
            "id": f"vh-{job_id[:20]}",
            "jobId": job_id,
            "mode": spec.get("mode", "A"),
            "title": title,
            "topic": spec.get("topic"),
            "ratio": proposal.get("ratio", "16:9"),
            "styleCode": proposal.get("styleCode", "A1"),
            "styleName": proposal.get("styleName", STYLE_NAME),
            "voice": spec.get("voice", "tongtong"),
            "narrationLang": spec.get("narrationLang", "id"),
            "status": status,
            "stage": stage,
            "proposalJson": json.dumps(proposal, ensure_ascii=False),
            "resultJson": json.dumps(result, ensure_ascii=False),
            "durationSec": result.get("duration"),
            "createdAt": spec.get("createdAt", "2026-11-12T21:27:16.609Z"),
            "updatedAt": spec.get("createdAt", "2026-11-12T21:27:16.609Z"),
        }
        con = sqlite3.connect(DB)
        try:
            insert_row(con.cursor(), row)
            con.commit()
            print(f"  row inserted (status={status})")
        finally:
            con.close()

    print(f"\nSelesai. done={complete_jobs} error={partial_jobs}")


if __name__ == "__main__":
    sys.exit(main())
