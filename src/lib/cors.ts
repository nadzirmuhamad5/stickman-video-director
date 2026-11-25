import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// CORS untuk API server produksi: frontend statis (mis. di Vercel) memanggil
// API lintas origin. Tidak ada cookie/auth di API ini, jadi Allow-Origin *
// aman. next.config.ts juga menambahkan header pada semua respons /api/*.
// ---------------------------------------------------------------------------

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
};

/** Respons 204 untuk preflight OPTIONS. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
