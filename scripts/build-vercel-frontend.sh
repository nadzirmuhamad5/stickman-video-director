#!/usr/bin/env bash
# Build frontend statis untuk deploy ke Vercel (atau hosting statis lain).
#
# App ini punya API routes Node (ffmpeg, Python, SQLite) yang TIDAK bisa
# jalan di Vercel — frontend di-deploy statis murni, dan semua panggilan
# /api/* diarahkan user ke server produksi via panel Status (localStorage
# "backendOrigin" / env NEXT_PUBLIC_API_BASE).
#
# Trik: route API Next.js disingkirkan sementara dari src/app selama build
# (output: "export" menolak route handler dinamis), lalu dikembalikan.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

STASH=".vercel-api-stash"
API_DIR="src/app/api"

restore() {
  if [ -d "$STASH" ] && [ ! -d "$API_DIR" ]; then
    mv "$STASH" "$API_DIR"
    echo "[build:vercel] src/app/api dikembalikan."
  fi
}
trap restore EXIT

if [ -d "$API_DIR" ]; then
  rm -rf "$STASH"
  mv "$API_DIR" "$STASH"
  echo "[build:vercel] src/app/api dipindah sementara (statis murni)."
fi

echo "[build:vercel] next build (NEXT_STATIC_EXPORT=1)..."
NEXT_STATIC_EXPORT=1 NEXT_TELEMETRY_DISABLED=1 npx next build

echo "[build:vercel] selesai — output statis di out/"
