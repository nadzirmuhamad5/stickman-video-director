"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Clapperboard,
  Film,
  Github,
  MonitorPlay,
  Wand2,
  CircleCheck,
  CircleAlert,
  Loader2,
  Mic,
  Music,
  ArrowDown,
  Sparkles,
  ShieldCheck,
  Scissors,
  FileText,
  Play,
} from "lucide-react";
import { STYLES, SELECTABLE_STYLES, DURATIONS, type StickmanStyle } from "@/lib/stickman-styles";

type ProposalClip = {
  index: number;
  stage: string;
  time: string;
  narrationEn: string;
  narrationId: string;
  beats: string[];
  devices: string[];
  transition: string;
};

type Proposal = {
  title: string;
  logline: string;
  ratio: string;
  durationSeconds: number;
  styleCode: string;
  styleName: string;
  voiceProfile: string;
  bgm: string;
  clips: ProposalClip[];
};

type StatusPayload = {
  skillInstalled: boolean;
  skillPath: string;
  doctor: { label: string; ok: boolean; detail: string }[];
  geminiKeyPresent: boolean;
  networkChecked: boolean;
  note: string;
  testsRunAtInstall: { total: number; passed: number; failed: number };
};

export default function Home() {
  const [selectedStyle, setSelectedStyle] = useState<string>("A1");
  const [topic, setTopic] = useState("");
  const [ratio, setRatio] = useState<"16:9" | "9:16">("16:9");
  const [durationSeconds, setDurationSeconds] = useState<number>(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const studioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/system/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));
  }, []);

  function pickStyle(style: StickmanStyle) {
    if (!style.selectable) return;
    setSelectedStyle(style.code);
    studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function generateProposal() {
    if (!topic.trim()) {
      setError("Tulis dulu topik atau tempel naskah Anda.");
      return;
    }
    const style = SELECTABLE_STYLES.find((s) => s.code === selectedStyle);
    if (!style) {
      setError("Pilih salah satu gaya A1–A5.");
      return;
    }
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      const res = await fetch("/api/director/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          ratio,
          durationSeconds,
          styleCode: style.code,
          styleName: `${style.name} (${style.tagline})`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Gagal menghasilkan proposal.");
      } else {
        setProposal(data.proposal as Proposal);
      }
    } catch {
      setError("Koneksi ke server gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  const clipCount = Math.round(durationSeconds / 10);

  return (
    <div className="dark min-h-screen flex flex-col bg-background text-foreground">
      {/* NAVBAR */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-stone-950">
              <Clapperboard className="h-4 w-4" />
            </span>
            <span className="truncate text-sm font-semibold tracking-tight">
              Stickman Video Director
            </span>
            <Badge variant="outline" className="ml-1 hidden border-amber-500/50 text-amber-500 sm:inline-flex">
              Terpasang
            </Badge>
          </div>
          <nav className="flex items-center gap-1 sm:gap-3">
            <a href="#gaya" className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground sm:block">
              Gaya
            </a>
            <a href="#studio" className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground sm:block">
              Studio
            </a>
            <a href="#status" className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground sm:block">
              Status
            </a>
            <a
              href="https://github.com/kaomei/stickman-video-director"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <Github className="h-3.5 w-3.5" />
              Repo
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* HERO */}
        <section className="border-b border-border/60 bg-gradient-to-b from-amber-500/[0.07] to-transparent">
          <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:py-20">
            <Badge variant="outline" className="mb-5 border-amber-500/40 bg-amber-500/10 text-amber-500">
              <Sparkles className="mr-1 h-3 w-3" /> Skill open source · MIT License
            </Badge>
            <h1 className="mx-auto max-w-3xl text-balance text-3xl font-bold tracking-tight sm:text-5xl">
              Ubah naskah apa pun jadi{" "}
              <span className="text-amber-500">video animasi stickman</span> yang siap unggah
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm text-muted-foreground sm:text-base">
              Dua mode dalam satu skill: <strong className="text-foreground">Director</strong> untuk
              storyboard &amp; prompt per adegan, dan <strong className="text-foreground">Autopilot</strong> untuk
              video MP4 lengkap dengan narasi, subtitle, dan efek suara. Tanpa kamera, tanpa langganan mahal.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="bg-amber-500 text-stone-950 hover:bg-amber-400">
                <a href="#studio">
                  <Wand2 className="mr-2 h-4 w-4" /> Coba Studio Director
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="#gaya">
                  Lihat 10 Gaya <ArrowDown className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-amber-500" /> 102/102 test runtime lulus
              </span>
              <span className="flex items-center gap-1.5">
                <CircleCheck className="h-3.5 w-3.5 text-amber-500" /> FFmpeg + renderer lokal siap
              </span>
              <span className="flex items-center gap-1.5">
                <Film className="h-3.5 w-3.5 text-amber-500" /> 6 gaya Director · 4 gaya Autopilot
              </span>
            </div>
          </div>
        </section>

        {/* MODES */}
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Dua mode, satu skill</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
            Pilih cara kerja yang pas: kendali penu di tangan Anda, atau serahkan seluruh perakitan ke runtime lokal.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Card className="border-border/70">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
                    <Scissors className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-widest text-amber-500">Mode A</p>
                    <h3 className="text-lg font-semibold">Director</h3>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li>• Proposal cerita + storyboard per bagian (klip ±10 detik)</li>
                  <li>• Prompt video siap-tempel untuk Google Flow / alat sejenis</li>
                  <li>• Anda generate klip &amp; finalisasi di CapCut — kendali penuh</li>
                  <li>• Tanpa API key, cocok untuk Shorts 30 dtk s.d. video 3 menit</li>
                </ul>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
                    <MonitorPlay className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-widest text-amber-500">Mode B</p>
                    <h3 className="text-lg font-semibold">Autopilot</h3>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li>• Dari satu permintaan → MP4 utuh yang bisa langsung diunggah</li>
                  <li>• Narasi TTS, subtitle semantik, ilustrasi, micro-animation, SFX</li>
                  <li>• Sampel ±20 detik dulu untuk disetujui sebelum produksi penuh</li>
                  <li>• Butuh layanan image generation &amp; TTS (dicek otomatis)</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* STYLE GALLERY */}
        <section id="gaya" className="border-y border-border/60 bg-stone-900/40 scroll-mt-14">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Pilih gaya visual</h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
              Semua contoh di bawah adalah sampel asli dari repo. Klik <em>Pilih</em> pada gaya A1–A5 untuk memakainya
              di Studio Director.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {STYLES.map((s) => (
                <Card key={s.code} className="group overflow-hidden border-border/70 pt-0">
                  <div className="relative aspect-video overflow-hidden bg-stone-950">
                    <img
                      src={s.previews[0].src}
                      alt={`Contoh gaya ${s.code} — ${s.name}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    <span className="absolute left-2 top-2 rounded-md bg-stone-950/80 px-2 py-0.5 text-xs font-bold text-amber-500 backdrop-blur">
                      {s.code}
                    </span>
                    <span className="absolute right-2 top-2 rounded-md bg-stone-950/80 px-2 py-0.5 text-[10px] uppercase tracking-wider text-stone-300 backdrop-blur">
                      Mode {s.mode}
                    </span>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="text-sm font-semibold">{s.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.tagline}</p>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                    <div className="mt-3">
                      {s.selectable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className={
                            selectedStyle === s.code
                              ? "w-full border-amber-500 bg-amber-500 text-stone-950 hover:bg-amber-400"
                              : "w-full hover:border-amber-500/50 hover:text-amber-500"
                          }
                          onClick={() => pickStyle(s)}
                        >
                          {selectedStyle === s.code ? "✓ Dipilih untuk Studio" : "Pilih untuk Studio"}
                        </Button>
                      ) : (
                        <Badge variant="outline" className="w-full justify-center border-border text-muted-foreground">
                          Rute khusus — via percakapan
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* DIRECTOR STUDIO */}
        <section id="studio" ref={studioRef} className="mx-auto max-w-6xl scroll-mt-14 px-4 py-14">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Studio Director — demo langsung</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
            Ini simulasi <strong className="text-foreground">Tahap A (Proposal Sutradara)</strong> dari Mode A: struktur
            5 babak, narasi EN + terjemahan, beat berwaktu, dan perangkat visual per klip. Setelah proposal disetujui,
            Mode A lanjut ke prompt per klip di percakapan.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-5">
            {/* FORM */}
            <Card className="lg:col-span-2 border-border/70">
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <Label htmlFor="topic">Topik / naskah / kebutuhan</Label>
                  <Textarea
                    id="topic"
                    placeholder="Contoh: Mengapa manusia prokrastinasi menurut sains — atau tempel artikel/naskah Anda di sini"
                    className="min-h-28 resize-y"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Rasio aspek</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["16:9", "9:16"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRatio(r)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          ratio === r
                            ? "border-amber-500 bg-amber-500/10 text-amber-500"
                            : "border-border text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {r === "16:9" ? "16:9 Horizontal" : "9:16 Vertikal"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Durasi</Label>
                    <Select value={String(durationSeconds)} onValueChange={(v) => setDurationSeconds(Number(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih durasi" />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATIONS.map((d) => (
                          <SelectItem key={d.seconds} value={String(d.seconds)}>
                            {d.label} · {d.clips} klip
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Gaya visual</Label>
                    <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih gaya" />
                      </SelectTrigger>
                      <SelectContent>
                        {SELECTABLE_STYLES.map((s) => (
                          <SelectItem key={s.code} value={s.code}>
                            {s.code} — {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={generateProposal}
                  disabled={loading}
                  className="w-full bg-amber-500 text-stone-950 hover:bg-amber-400"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Menyusun proposal…
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-4 w-4" /> Hasilkan Proposal Sutradara
                    </>
                  )}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  {clipCount} klip × ±10 detik · narasi ±{clipCount * 22} kata
                </p>

                {error && (
                  <Alert variant="destructive">
                    <CircleAlert className="h-4 w-4" />
                    <AlertTitle>Gagal</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* RESULT */}
            <div className="lg:col-span-3">
              {loading && (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-44 w-full" />
                    ))}
                  </div>
                </div>
              )}

              {!loading && !proposal && (
                <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center">
                  <Film className="h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">Proposal Anda akan muncul di sini</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                    Isi topik di kiri, tekan tombol, dan laporan sutradara lengkap disusun otomatis oleh AI.
                  </p>
                </div>
              )}

              {!loading && proposal && (
                <div className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-amber-500 text-stone-950">Tahap A · Proposal</Badge>
                      <Badge variant="outline" className="border-border text-muted-foreground">
                        {proposal.styleCode} · {proposal.ratio} · {proposal.durationSeconds}s
                      </Badge>
                    </div>
                    <h3 className="mt-3 text-xl font-bold tracking-tight">{proposal.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{proposal.logline}</p>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="flex items-start gap-2 rounded-lg border border-border/70 p-2.5">
                        <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="text-muted-foreground">
                          <strong className="text-foreground">Suara:</strong> {proposal.voiceProfile}
                        </span>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border border-border/70 p-2.5">
                        <Music className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="text-muted-foreground">
                          <strong className="text-foreground">BGM:</strong> {proposal.bgm}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
                    {proposal.clips.map((c) => (
                      <Card key={c.index} className="border-border/70">
                        <CardContent className="p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-xs font-bold text-stone-950">
                              {c.index}
                            </span>
                            <Badge variant="outline" className="border-amber-500/40 text-[10px] uppercase tracking-wider text-amber-500">
                              {c.stage}
                            </Badge>
                            <span className="ml-auto font-mono text-xs text-muted-foreground">{c.time}</span>
                          </div>

                          <p className="mt-3 text-sm leading-relaxed">
                            <Play className="mr-1.5 inline h-3 w-3 text-amber-500" />
                            {c.narrationEn}
                          </p>
                          <p className="mt-1 text-xs italic leading-relaxed text-muted-foreground">“{c.narrationId}”</p>

                          <div className="mt-3 space-y-1.5">
                            {c.beats.map((b, i) => (
                              <div key={i} className="flex gap-2 text-xs">
                                <span className="shrink-0 font-mono text-amber-500/90">{b.slice(0, b.indexOf("]") + 1)}</span>
                                <span className="text-muted-foreground">{b.slice(b.indexOf("]") + 1).trim()}</span>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {c.devices.map((d, i) => (
                              <span key={i} className="rounded-md bg-stone-800/80 px-2 py-0.5 text-[10px] text-stone-300">
                                {d}
                              </span>
                            ))}
                          </div>

                          {c.transition && (
                            <p className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                              <FileText className="mr-1 inline h-3 w-3" /> Transisi: {c.transition}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Alert className="border-amber-500/40 bg-amber-500/[0.06]">
                    <ShieldCheck className="h-4 w-4 text-amber-500" />
                    <AlertTitle className="text-amber-500">Gerbang persetujuan</AlertTitle>
                    <AlertDescription className="text-xs leading-relaxed">
                      Ini laporan Tahap A. Jika sudah cocok, lanjutkan di percakapan:{" "}
                      <em>“Proposal ini disetujui, buat prompt video per klip (Tahap B).”</em> Ubah rasio, durasi, gaya,
                      atau struktur berarti proposal disusun ulang.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SYSTEM STATUS */}
        <section id="status" className="border-t border-border/60 bg-stone-900/40 scroll-mt-14">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Status instalasi runtime</h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
              Hasil nyata perintah <code className="rounded bg-stone-800 px-1.5 py-0.5 text-xs">doctor</code> dari
              runtime Autopilot yang terpasang di server ini.
            </p>
            <div className="mx-auto mt-8 max-w-3xl space-y-3">
              {!status && (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              )}
              {status && (
                <>
                  {status.doctor.map((c) => (
                    <div
                      key={c.label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        {c.ok ? (
                          <CircleCheck className="h-5 w-5 shrink-0 text-green-500" />
                        ) : (
                          <CircleAlert className="h-5 w-5 shrink-0 text-red-500" />
                        )}
                        <span className="text-sm font-medium">{c.label}</span>
                      </div>
                      <Badge variant="outline" className={c.ok ? "border-green-500/40 text-green-500" : "border-red-500/40 text-red-500"}>
                        {c.detail}
                      </Badge>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-4 py-3">
                    <div className="flex items-center gap-3">
                      {status.geminiKeyPresent ? (
                        <CircleCheck className="h-5 w-5 shrink-0 text-green-500" />
                      ) : (
                        <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" />
                      )}
                      <span className="text-sm font-medium">Layanan image generation (Gemini)</span>
                    </div>
                    <Badge variant="outline" className={status.geminiKeyPresent ? "border-green-500/40 text-green-500" : "border-amber-500/40 text-amber-500"}>
                      {status.geminiKeyPresent ? "Key terdeteksi" : "Belum dikonfigurasi"}
                    </Badge>
                  </div>
                  <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                    {status.note} Mode A (Director) tidak memerlukan key apa pun. Runtime skill terpasang di{" "}
                    <code className="rounded bg-stone-800 px-1.5 py-0.5">{status.skillPath}</code> ·{" "}
                    {status.testsRunAtInstall.passed}/{status.testsRunAtInstall.total} test lulus saat instalasi.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER — sticky bottom */}
      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-1.5">
            <Clapperboard className="h-3.5 w-3.5 text-amber-500" />
            Stickman Video Director · open source MIT
          </p>
          <a
            href="https://github.com/kaomei/stickman-video-director"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" /> kaomei/stickman-video-director
          </a>
        </div>
      </footer>
    </div>
  );
}
