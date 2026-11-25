// ---------------------------------------------------------------------------
// Alamat server produksi (backend).
//
// Frontend statis (mis. di-deploy ke Vercel) tidak punya API sendiri — semua
// panggilan /api/* dan /api/media/* diarahkan ke "backend origin":
//   1. nilai yang disimpan user di UI (localStorage "backendOrigin"),
//   2. atau NEXT_PUBLIC_API_BASE (baked saat build),
//   3. atau kosong = same-origin (mode self-host / preview sandbox).
// ---------------------------------------------------------------------------

const LS_KEY = "backendOrigin";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getBackendOrigin(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(LS_KEY)?.trim();
    if (stored) return stripTrailingSlash(stored);
  }
  const envBase = process.env.NEXT_PUBLIC_API_BASE?.trim() ?? "";
  return stripTrailingSlash(envBase);
}

export function setBackendOrigin(url: string): void {
  if (typeof window === "undefined") return;
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) window.localStorage.setItem(LS_KEY, clean);
  else window.localStorage.removeItem(LS_KEY);
}

/** Prefix path /api/... dengan backend origin (bila dikonfigurasi). */
export function apiUrl(path: string): string {
  const base = getBackendOrigin();
  return base ? `${base}${path}` : path;
}

/** URL media relatif dari API (videoUrl/posterUrl/srtUrl) → absolut. */
export function absUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  return apiUrl(url);
}

export function isCrossOriginBackend(): boolean {
  if (typeof window === "undefined") return false;
  const base = getBackendOrigin();
  if (!base) return false;
  try {
    return new URL(base).origin !== window.location.origin;
  } catch {
    return true;
  }
}
