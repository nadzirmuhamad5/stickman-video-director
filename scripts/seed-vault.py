#!/usr/bin/env python3
"""Seed vault/ from the current DB + production outputs (one-off bootstrap).

Mirrors src/lib/vault.ts persistToVault(): copies job.json, final.mp4,
poster.jpg, captions.srt into vault/<jobId>/ and writes vault/index.json.
"""
import json
import shutil
import sqlite3
from pathlib import Path

ROOT = Path("/home/z/my-project")
VAULT = ROOT / "vault"
VAULT_FILES = ["job.json", "final.mp4", "poster.jpg", "captions.srt"]

con = sqlite3.connect(ROOT / "db/custom.db")
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute("SELECT * FROM Production WHERE status='done'").fetchall()]
con.close()

VAULT.mkdir(exist_ok=True)
index = []
for row in rows:
    job_id = row["jobId"]
    src = ROOT / "production" / job_id
    dst = VAULT / job_id
    dst.mkdir(exist_ok=True)
    copied = []
    for name in VAULT_FILES:
        f = src / name
        if f.exists():
            shutil.copy2(f, dst / name)
            copied.append(name)
    entry = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()}
    index.append(entry)
    print(f"[vault] {job_id[:8]}: {', '.join(copied)}")

(VAULT / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
print(f"index.json: {len(index)} entri")
