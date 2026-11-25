"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl, absUrl, getBackendOrigin, setBackendOrigin, isCrossOriginBackend } from "@/lib/api-base";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Download,
  Video,
  RefreshCw,
  Volume2,
  Languages,
  KeyRound,
  Lightbulb,
  History,
  Zap,
} from "lucide-react";
import { STYLES, SELECTABLE_STYLES, DURATIONS, type StickmanStyle } from "@/lib/stickman-styles";
import { TTS_VOICES, DEFAULT_VOICE } from "@/lib/tts-voices";

const EDGE_VOICES = TTS_VOICES.filter((v) => v.engine === "edge");
const ZAI_VOICES = TTS_VOICES.filter((v) => v.engine === "zai");
const firstVoiceFor = (lang: "id" | "en") =>
  TTS_VOICES.find((v) => v.lang === lang && v.engine === "edge")?.id ??
  TTS_VOICES.find((v) => v.lang === lang)?.id ??
  DEFAULT_VOICE;

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

type ProposalScore = {
  total: number;
  hook: number;
  story: number;
  retensi: number;
  klaritas: number;
  tips: string[];
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
  score?: ProposalScore | null;
};

type ClipProd = {
  index: number;
  status: "pending" | "working" | "done" | "error";
  illustration?: string;
  audioDuration?: number;
  error?: string;
};

type VideoResult = {
  duration: number;
  videoUrl: string;
  posterUrl: string;
  srtUrl: string;
};

type ProductionStatus = {
  jobId: string;
  progress: {
    stage: "assets" | "render" | "done" | "error";
    message?: string;
    clips: Record<string, { image?: boolean; audio?: boolean; audioDuration?: number; illustration?: string }>;
    render?: { message: string; pct: number };
    totalDuration?: number;
    result?: VideoResult;
    updatedAt: string;
  };
  done: boolean;
  running: boolean;
};

type StatusPayload = {
  skillInstalled: boolean;
  skillPath: string;
  doctor: { label: string; ok: boolean; detail: string }[];
  edgeTts?: { ok: boolean; detail: string };
  geminiKeyPresent: boolean;
  geminiKeySource?: "env" | "file" | null;
  geminiKeyMasked?: string | null;
  networkChecked: boolean;
  note: string;
  testsRunAtInstall: { total: number; passed: number; failed: number };
};

type HistoryItem = {
  jobId: string;
  mode: "A" | "B";
  title: string;
  topic?: string | null;
  ratio: string;
  styleCode: string;
  styleName?: string | null;
  voice: string;
  narrationLang: string;
  status: string;
  stage: string;
  durationSec?: number | null;
  createdAt: string;
  updatedAt: string;
};

type Idea = { title: string; hook: string; whyViral: string; opening: string };

const IDEA_CATEGORIES = [
  { id: "fakta-unik", label: "Fakta Unik" },
  { id: "fakta-sejarah", label: "Fakta Sejarah" },
  { id: "misteri", label: "Misteri" },
  { id: "psikologi", label: "Psikologi" },
  { id: "sains", label: "Sains" },
  { id: "uang-bisnis", label: "Uang & Bisnis" },
  { id: "teknologi", label: "Teknologi & AI" },
  { id: "lifestyle", label: "Lifestyle & Tips" },
];

export default function Home() {
  const [selectedStyle, setSelectedStyle] = useState<string>("A1");
  const [topic, setTopic] = useState("");
  const [ratio, setRatio] = useState<"16:9" | "9:16">("16:9");
  const [durationSeconds, setDurationSeconds] = useState<number>(60);
  // "auto" = ikut durasi (±8 dtk/klip), atau "3".."12" untuk jumlah klip tetap (Mode A)
  const [clipCountSel, setClipCountSel] = useState<string>("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const studioRef = useRef<HTMLDivElement>(null);

  // Mode produksi: A = Director (review proposal dulu), B = Autopilot (langsung jadi)
  const [mode, setMode] = useState<"A" | "B">("A");
  const [styleB, setStyleBRaw] = useState<"B1" | "B2" | "B3" | "B4">("B1");

  // B4 (Thriller) butuh ilustrasi Gemini: default bahasa Inggris + Brian.
  function setStyleB(code: "B1" | "B2" | "B3" | "B4") {
    setStyleBRaw(code);
    if (code === "B4") {
      setNarrationLang("en");
      setVoice("en-US-BrianNeural");
    }
  }

  // Generator ide viral
  const [ideaCategory, setIdeaCategory] = useState("fakta-unik");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);

  // Riwayat produksi (persisten di database — tahan refresh)
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Production (Tahap B) state
  const [jobId, setJobId] = useState<string | null>(null);
  const [narrationLang, setNarrationLang] = useState<"id" | "en">("id");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [previewing, setPreviewing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [prodPhase, setProdPhase] = useState<"idle" | "assets" | "render" | "done" | "error">("idle");
  const [prodMessage, setProdMessage] = useState("");
  const [prodError, setProdError] = useState<string | null>(null);
  const [clipProd, setClipProd] = useState<ClipProd[]>([]);
  const [videoResult, setVideoResult] = useState<VideoResult | null>(null);
  const [prodPct, setProdPct] = useState(0);

  // Polling refs — produksi berjalan di server; client hanya memantau.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTokenRef = useRef(0);

  function stopPolling() {
    pollTokenRef.current += 1;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  useEffect(() => {
    fetch(apiUrl("/api/system/status"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));
    fetch(apiUrl("/api/productions"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHistory(d?.productions ?? []))
      .catch(() => setHistory([]));
    return () => stopPolling();
  }, []);

  function pickStyle(style: StickmanStyle) {
    if (!style.selectable) return;
    setSelectedStyle(style.code);
    studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function changeNarrationLang(lang: "id" | "en") {
    setNarrationLang(lang);
    const current = TTS_VOICES.find((v) => v.id === voice);
    if (!current || current.lang !== lang) setVoice(firstVoiceFor(lang));
  }

  function stopPreview() {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewing(false);
  }

  async function previewVoice() {
    if (previewing) {
      stopPreview();
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch(apiUrl("/api/tts/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: voice, lang: narrationLang }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Gagal memuat contoh suara.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
          setPreviewing(false);
        }
      };
      await audio.play();
    } catch (err) {
      setPreviewing(false);
      setProdError(err instanceof Error ? err.message : "Gagal memutar contoh suara.");
    }
  }

  // Gemini key editor (Status panel) state
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [geminiInput, setGeminiInput] = useState("");
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);

  // Server produksi (backend origin) editor — untuk frontend yang di-host terpisah (mis. Vercel)
  const [backendInput, setBackendInput] = useState("");
  const [backendSaved, setBackendSaved] = useState(false);
  useEffect(() => {
    setBackendInput(getBackendOrigin());
  }, []);

  function saveBackendOrigin() {
    setBackendOrigin(backendInput);
    setBackendInput(getBackendOrigin());
    setBackendSaved(true);
    setTimeout(() => setBackendSaved(false), 2500);
  }

  function backendHint(): string {
    return isCrossOriginBackend()
      ? " Cek URL Server Produksi di panel Status; server yang baru menyala bisa butuh ±1 menit (cold start), lalu coba lagi."
      : "";
  }

  function patchStatusGemini(present: boolean, source: "env" | "file" | null, masked: string | null) {
    setStatus((prev) => (prev ? { ...prev, geminiKeyPresent: present, geminiKeySource: source, geminiKeyMasked: masked } : prev));
  }

  async function loadGeminiInfo(): Promise<{ present: boolean; masked: string | null; source: "env" | "file" | null } | null> {
    try {
      const res = await fetch(apiUrl("/api/settings/gemini"));
      if (!res.ok) return null;
      const d = await res.json();
      return { present: Boolean(d.present), masked: d.masked ?? null, source: d.source ?? null };
    } catch {
      return null;
    }
  }

  async function saveGeminiKeyAction() {
    const key = geminiInput.trim();
    if (!key) {
      setGeminiMsg({ kind: "error", text: "Tempel dulu API key-nya." });
      return;
    }
    setGeminiBusy(true);
    setGeminiMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/gemini"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGeminiMsg({ kind: "error", text: data.error ?? "Gagal menyimpan key." });
        return;
      }
      const info = await loadGeminiInfo();
      if (info) patchStatusGemini(info.present, info.source, info.masked);
      setGeminiInput("");
      setGeminiMsg(
        data.warning
          ? { kind: "warn", text: `Tersimpan, dengan catatan: ${data.warning}` }
          : { kind: "ok", text: "Key tersimpan. Status sekarang: Key terdeteksi." }
      );
    } catch {
      setGeminiMsg({ kind: "error", text: "Koneksi ke server gagal. Coba lagi." });
    } finally {
      setGeminiBusy(false);
    }
  }

  async function clearGeminiKeyAction() {
    setGeminiBusy(true);
    setGeminiMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/gemini"), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setGeminiMsg({ kind: "error", text: data.error ?? "Gagal menghapus key." });
        return;
      }
      const info = await loadGeminiInfo();
      if (info) patchStatusGemini(info.present, info.source, info.masked);
      setGeminiMsg({ kind: "ok", text: "Key dihapus dari web." });
    } catch {
      setGeminiMsg({ kind: "error", text: "Koneksi ke server gagal. Coba lagi." });
    } finally {
      setGeminiBusy(false);
    }
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
    setJobId(null);
    stopPolling();
    setProdPhase("idle");
    setProdMessage("");
    setProdError(null);
    setClipProd([]);
    setVideoResult(null);
    setProdPct(0);
    try {
      const res = await fetch(apiUrl("/api/director/proposal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          ratio,
          durationSeconds,
          clipCount: clipCountSel === "auto" ? undefined : Number(clipCountSel),
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
      setError("Koneksi ke server gagal. Coba lagi." + backendHint());
    } finally {
      setLoading(false);
    }
  }

  // Jumlah klip efektif Mode A: pilihan user atau auto (durasi ÷ ±8 dtk)
  const clipCount =
    clipCountSel === "auto" ? Math.max(3, Math.min(12, Math.round(durationSeconds / 8))) : Number(clipCountSel);
  const perClipSeconds = Math.round(durationSeconds / clipCount);

  // ---------------------------------------------------------------------
  // Produksi berjalan SEPENUHNYA di server (background). Client hanya
  // polling status setiap 2 detik, sehingga menutup/refresh tab tidak
  // menghentikan produksi lagi.
  // ---------------------------------------------------------------------
  async function pollProduction(id: string): Promise<void> {
    const token = ++pollTokenRef.current;
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (pollTokenRef.current !== token) return;
      let d: ProductionStatus | null = null;
      try {
        const res = await fetch(apiUrl(`/api/production/status/${id}`));
        d = res.ok ? ((await res.json()) as ProductionStatus) : null;
      } catch {
        d = null; // gangguan jaringan sesaat — teruskan polling
      }
      if (pollTokenRef.current !== token) return;
      if (!d) continue;

      const p = d.progress;
      const clipsState = p.clips ?? {};
      const order = proposal?.clips.map((c) => c.index) ??
        Object.keys(clipsState).map(Number).sort((a, b) => a - b);

      setClipProd((prev) => {
        let firstUndoneMarked = false;
        return order.map((index) => {
          const st = clipsState[String(index)];
          const complete = Boolean(st?.image && st?.audio);
          let status: ClipProd["status"] = complete ? "done" : "pending";
          if (!complete && (d?.running || p.stage === "render") && !firstUndoneMarked) {
            status = "working";
            firstUndoneMarked = true;
          }
          const prevClip = prev.find((c) => c.index === index);
          return {
            index,
            status,
            illustration: st?.illustration ?? prevClip?.illustration,
            audioDuration: st?.audioDuration,
            error: undefined,
          };
        });
      });

      if (p.stage === "done" && p.result) {
        setVideoResult(p.result);
        setProdPhase("done");
        setProdMessage("");
        setProdPct(100);
        void loadHistory();
        return;
      }
      if (p.stage === "error") {
        setProdError(p.message ?? "Produksi gagal.");
        setProdPhase("error");
        return;
      }
      if (!d.running && !p.result) {
        // Server sempat restart sehingga job latar belakang hilang.
        setProdError(
          "Produksi terputus karena server restart. Aset yang sudah jadi tetap tersimpan — tekan Lanjutkan Produksi untuk meneruskan."
        );
        setProdPhase("error");
        return;
      }
      if (p.stage === "render") {
        setProdPhase("render");
        setProdMessage(p.render?.message ?? "Merender video…");
        setProdPct(p.render?.pct ?? 0);
      } else {
        setProdPhase("assets");
        setProdMessage(p.message ?? "Menyiapkan aset produksi…");
      }
    }
  }

  async function produceVideo() {
    if (mode === "B") {
      await produceAutopilot();
      return;
    }
    if (!proposal) return;
    stopPolling();
    setError(null);
    setProdError(null);
    setVideoResult(null);
    setProdPhase("assets");
    setProdMessage("Menyiapkan job produksi…");
    setProdPct(0);
    setClipProd(proposal.clips.map((c) => ({ index: c.index, status: "pending" as const })));
    try {
      const res = await fetch(apiUrl("/api/production/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal, narrationLang, voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memulai produksi.");
      const id = data.jobId as string;
      setJobId(id);
      await pollProduction(id);
    } catch (err) {
      setProdError(err instanceof Error ? err.message : "Produksi gagal.");
      setProdPhase("error");
    }
  }

  async function produceAutopilot() {
    if (!topic.trim()) {
      setProdError("Tulis dulu topik atau tempel naskah Anda.");
      setProdPhase("error");
      return;
    }
    stopPolling();
    setError(null);
    setProdError(null);
    setVideoResult(null);
    setProposal(null);
    setClipProd([]);
    setProdPhase("assets");
    setProdMessage("Menyiapkan produksi autopilot…");
    setProdPct(0);
    try {
      const res = await fetch(apiUrl("/api/autopilot/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          ratio,
          durationSeconds,
          styleB,
          narrationLang,
          voice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memulai autopilot.");
      const id = data.jobId as string;
      setJobId(id);
      await pollProduction(id);
    } catch (err) {
      setProdError(err instanceof Error ? err.message : "Autopilot gagal.");
      setProdPhase("error");
    }
  }

  async function fetchIdeas() {
    setIdeasLoading(true);
    setIdeasError(null);
    try {
      const res = await fetch(apiUrl("/api/ideas"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: ideaCategory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mencari ide.");
      setIdeas(data.ideas as Idea[]);
    } catch (err) {
      setIdeasError(err instanceof Error ? err.message : "Gagal mencari ide.");
      setIdeas([]);
    } finally {
      setIdeasLoading(false);
    }
  }

  function applyIdea(idea: Idea) {
    setTopic(`${idea.title}. ${idea.hook} ${idea.opening}`.trim());
    studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadHistory() {
    try {
      const res = await fetch(apiUrl("/api/productions"));
      const d = res.ok ? await res.json() : null;
      setHistory(d?.productions ?? []);
    } catch {
      // diam — riwayat cuma pelengkap
    }
  }

  async function restoreProduction(item: HistoryItem) {
    stopPolling();
    setError(null);
    setProdError(null);
    setVideoResult(null);
    setProdPct(0);
    setMode(item.mode);
    setJobId(item.jobId);
    setProdPhase("assets");
    setProdMessage("Memuat produksi dari riwayat…");
    try {
      const res = await fetch(apiUrl(`/api/productions/${item.jobId}`));
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal memuat produksi.");
      if (item.mode === "A" && d.proposal) {
        setProposal(d.proposal as Proposal);
        setClipProd((d.proposal as Proposal).clips.map((c) => ({ index: c.index, status: "done" as const })));
      } else {
        setProposal(null);
        setClipProd([]);
      }
      if (d.result && !d.result.error) {
        setVideoResult(d.result as VideoResult);
        setProdPhase("done");
        setProdMessage("");
      } else if (d.status === "error") {
        setProdError(d.result?.error ?? "Produksi gagal sebelumnya.");
        setProdPhase("error");
      } else {
        // masih berjalan di latar belakang (atau sempat terputus) — pantau lagi
        setProdPhase("assets");
        setProdMessage("Melanjutkan pemantauan produksi…");
        await pollProduction(item.jobId);
      }
      studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setProdError(err instanceof Error ? err.message : "Gagal memuat produksi.");
      setProdPhase("error");
    }
  }

  async function retryProduction() {
    if (!jobId) {
      await produceVideo();
      return;
    }
    stopPolling();
    setProdError(null);
    setProdPhase("assets");
    setProdMessage("Melanjutkan produksi dari aset yang sudah ada…");
    setProdPct(0);
    try {
      const res = await fetch(apiUrl("/api/production/resume"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal melanjutkan produksi.");
      await pollProduction(jobId);
    } catch (err) {
      setProdError(err instanceof Error ? err.message : "Produksi gagal.");
      setProdPhase("error");
    }
  }

  // Panel produksi bersama: dipakai Mode A (di bawah proposal) dan Mode B /
  // restore riwayat (tanpa proposal).
  const prodPanel = (
    <Card className="border-amber-500/30 bg-amber-500/[0.04]">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-amber-500 text-stone-950">
            {mode === "B" ? "Autopilot · Produksi Video" : "Tahap B · Produksi Video"}
          </Badge>
          {prodPhase === "idle" && (
            <Badge variant="outline" className="border-border text-muted-foreground">
              Menunggu persetujuan Anda
            </Badge>
          )}
          {prodPhase === "assets" && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              Menyiapkan…
            </Badge>
          )}
          {prodPhase === "render" && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              Merender…
            </Badge>
          )}
          {prodPhase === "done" && (
            <Badge variant="outline" className="border-green-500/50 text-green-500">
              Video siap
            </Badge>
          )}
          {prodPhase === "error" && (
            <Badge variant="outline" className="border-red-500/50 text-red-500">
              Terhenti
            </Badge>
          )}
        </div>

        {prodPhase === "idle" && mode === "A" && proposal && (
          <>
            <Button
              onClick={produceVideo}
              className="w-full bg-amber-500 text-stone-950 hover:bg-amber-400"
            >
              <Video className="mr-2 h-4 w-4" /> Setuju &amp; Produksi Video ({proposal.clips.length} klip)
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Ilustrasi AI per klip + narasi suara pilihan + animasi canvas renderer di server ini. Perkiraan
              ±1–4 menit — produksi berjalan di server, jadi aman walau tab di-refresh.
            </p>
          </>
        )}

        {prodPhase !== "idle" && mode === "A" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {clipProd.map((p) => (
              <div
                key={p.index}
                className="flex items-center gap-3 rounded-lg border border-border/70 bg-background p-2.5"
              >
                <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-stone-900">
                  {p.illustration ? (
                    <img
                      src={absUrl(p.illustration)}
                      alt={`Ilustrasi klip ${p.index}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      {p.status === "working" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                      ) : (
                        <Film className="h-4 w-4 text-muted-foreground/50" />
                      )}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">Klip {p.index}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {p.status === "pending" && "Menunggu"}
                    {p.status === "working" && "Ilustrasi + narasi dibuat…"}
                    {p.status === "done" && `Siap · narasi ${(p.audioDuration ?? 0).toFixed(1)} dtk`}
                    {p.status === "error" && (p.error ?? "Gagal")}
                  </p>
                </div>
                {p.status === "done" && <CircleCheck className="h-4 w-4 shrink-0 text-green-500" />}
                {p.status === "error" && (
                  <Button size="sm" variant="outline" onClick={retryProduction} className="h-7 shrink-0 px-2 text-[11px]">
                    <RefreshCw className="mr-1 h-3 w-3" /> Ulangi
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {prodMessage && prodPhase !== "done" && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-xs text-amber-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {prodMessage}
            </p>
            {prodPhase === "render" && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${Math.max(4, prodPct)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {prodError && (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Produksi terhenti</AlertTitle>
            <AlertDescription className="text-xs">
              {prodError} Aset yang sudah jadi tidak diulang — tekan Lanjutkan Produksi untuk meneruskan.
            </AlertDescription>
          </Alert>
        )}

        {prodPhase === "done" && videoResult && (
          <div className="space-y-3">
            <video
              key={videoResult.videoUrl}
              src={absUrl(videoResult.videoUrl)}
              poster={absUrl(videoResult.posterUrl)}
              controls
              className="w-full rounded-xl border border-border bg-black"
            />
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-amber-500 text-stone-950 hover:bg-amber-400">
                <a href={`${absUrl(videoResult.videoUrl)}?download=1`}>
                  <Download className="mr-2 h-4 w-4" /> Unduh MP4 ({videoResult.duration.toFixed(0)} dtk)
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`${absUrl(videoResult.srtUrl)}?download=1`}>
                  <FileText className="mr-2 h-4 w-4" /> Subtitle SRT
                </a>
              </Button>
              <Button size="sm" variant="outline" onClick={produceVideo} disabled={prodPhase !== "done"}>
                <RefreshCw className="mr-2 h-4 w-4" /> Produksi Ulang
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Subtitle sudah dibakar ke dalam video; berkas SRT disediakan bila ingin menyunting di CapCut
              atau alat sejenis. Hasil juga tersimpan di Riwayat Produksi.
            </p>
          </div>
        )}

        {prodPhase === "error" && (
          <Button variant="outline" className="w-full" onClick={retryProduction}>
            <RefreshCw className="mr-2 h-4 w-4" /> Lanjutkan Produksi
          </Button>
        )}
      </CardContent>
    </Card>
  );

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
              Sekarang <strong className="text-foreground">semuanya jalan langsung di halaman ini</strong>: susun
              proposal, setujui, dan server merender video MP4 utuh — ilustrasi AI per klip, narasi suara TTS,
              subtitle terbakar, dan efek kamera. Tanpa kamera, tanpa langganan mahal, tanpa pindah aplikasi.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="bg-amber-500 text-stone-950 hover:bg-amber-400">
                <a href="#studio">
                  <Video className="mr-2 h-4 w-4" /> Buat Video Sekarang
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
                  <li>• Struktur 5 babak Heartbeat Engine + perangkat visual per klip</li>
                  <li>• Di studio ini: proposal langsung diproduksi jadi MP4 — klik sekali, video jadi</li>
                  <li>• Tanpa API key, cocok untuk Shorts 30 dtk s.d. video 2 menit</li>
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
                  <li>• Di studio ini: topik → video jadi dalam satu klik, tanpa review</li>
                  <li>• Naskah + storyboard dibuat AI, dianimasikan canvas renderer (stickman bergerak, props krayon, SFX)</li>
                  <li>• Narasi Edge Neural + subtitle semantik terbakar otomatis</li>
                  <li>• Berjalan di server — hasil tersimpan di Riwayat Produksi</li>
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
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Studio Video — buat langsung di sini</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
            <strong className="text-foreground">Mode A · Director:</strong> proposal sutradara dulu, review, lalu produksi —
            ilustrasi AI per klip. <strong className="text-foreground">Mode B · Autopilot:</strong> satu klik dari topik
            langsung jadi video animasi stickman. Semuanya dirender di server dengan canvas renderer — tab boleh ditutup.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-5">
            {/* FORM */}
            <Card className="lg:col-span-2 border-border/70">
              <CardContent className="space-y-5 p-6">
                {/* Mode toggle */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("A")}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      mode === "A"
                        ? "border-amber-500 bg-amber-500/10 text-amber-500"
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span className="block text-sm font-semibold">A · Director</span>
                    <span className="block text-[11px] opacity-80">review proposal dulu</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("B")}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      mode === "B"
                        ? "border-amber-500 bg-amber-500/10 text-amber-500"
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span className="block text-sm font-semibold">B · Autopilot</span>
                    <span className="block text-[11px] opacity-80">topik → video, satu klik</span>
                  </button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="topic">Topik / naskah / kebutuhan</Label>
                  <Textarea
                    id="topic"
                    placeholder={mode === "B" ? "Contoh: 3 fakta gila tentang mata uang kuno yang jadi kebiasaan hari ini" : "Contoh: Mengapa manusia prokrastinasi menurut sains — atau tempel artikel/naskah Anda di sini"}
                    className="min-h-28 resize-y"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>

                {/* Generator ide viral */}
                <div className="rounded-xl border border-border/70 bg-stone-900/40 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Ide konten viral
                    </Label>
                    <Select value={ideaCategory} onValueChange={setIdeaCategory}>
                      <SelectTrigger className="h-7 w-[150px] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {IDEA_CATEGORIES.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={fetchIdeas}
                    disabled={ideasLoading}
                    className="mt-2.5 w-full h-8 text-xs"
                  >
                    {ideasLoading ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Mencari tren di internet…
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 h-3 w-3" /> Cari Ide Berpotensi Viral
                      </>
                    )}
                  </Button>
                  {ideasError && <p className="mt-2 text-[11px] text-red-500">{ideasError}</p>}
                  {ideas.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {ideas.map((idea, i) => (
                        <div key={i} className="rounded-lg border border-border/60 bg-background p-2.5">
                          <p className="text-xs font-semibold leading-snug">{idea.title}</p>
                          <p className="mt-1 text-[11px] italic leading-snug text-muted-foreground">“{idea.hook}”</p>
                          <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
                            Kenapa viral: {idea.whyViral}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => applyIdea(idea)}
                            className="mt-1.5 h-6 px-2 text-[10px]"
                          >
                            Pakai ide ini
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
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

                <div className={mode === "A" ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : "grid grid-cols-2 gap-3"}>
                  <div className="space-y-2">
                    <Label>Durasi</Label>
                    <Select value={String(durationSeconds)} onValueChange={(v) => setDurationSeconds(Number(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih durasi" />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATIONS.map((d) => (
                          <SelectItem key={d.seconds} value={String(d.seconds)}>
                            {mode === "A" ? `${d.label} · ${d.clips} klip` : d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {mode === "A" ? (
                    <>
                      <div className="space-y-2">
                        <Label>Jumlah klip</Label>
                        <Select value={clipCountSel} onValueChange={setClipCountSel}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Jumlah klip" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto ({clipCount} klip)</SelectItem>
                            {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n} klip × ±{Math.round(durationSeconds / n)} dtk
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
                    </>
                  ) : (
                    <div className="space-y-2">
                      <Label>Gaya Autopilot</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ["B1", "Line Art", "Krayon putih, stickman + prop AI"],
                          ["B2", "Berwarna", "Krayon hangat berwarna + prop AI"],
                          ["B3", "Retro TV", "Gelap retrotv, siluet vektor"],
                          ["B4", "Thriller", "Ilustrasi sinematik · butuh key"],
                        ] as const).map(([code, label, desc]) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setStyleB(code)}
                            className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                              styleB === code
                                ? "border-amber-500 bg-amber-500/10 text-amber-500"
                                : "border-border text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            <span className="block text-xs font-semibold">
                              {code} · {label}
                            </span>
                            <span className="mt-0.5 block text-[10px] leading-tight opacity-80">
                              {desc}
                            </span>
                          </button>
                        ))}
                      </div>
                      {styleB === "B4" && (
                        <p className="text-[11px] text-muted-foreground">
                          B4 memakai narator Brian (Edge) + ilustrasi Gemini per adegan —
                          pasang Gemini API key di panel Status. Bahasa diubah ke English otomatis.
                        </p>
                      )}
                      {(styleB === "B1" || styleB === "B2") && (
                        <p className="text-[11px] text-muted-foreground">
                          Setiap beat menggambar objek konkret dari narasi (prop AI) — bukan cuma stickman.
                        </p>
                      )}
                      {styleB === "B3" && (
                        <p className="text-[11px] text-muted-foreground">
                          Panel objek &amp; diagram digambar vektor di bidang gelap, finishing televisi — tanpa API key.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Bahasa + suara narasi */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Languages className="h-3.5 w-3.5 text-amber-500" /> Bahasa narasi
                    </Label>
                    <Select value={narrationLang} onValueChange={(v) => changeNarrationLang(v as "id" | "en")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="id">Bahasa Indonesia</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-amber-500" /> Suara narator
                    </Label>
                    <div className="flex gap-2">
                      <Select value={voice} onValueChange={setVoice}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel className="text-amber-500">Edge Neural · terbaik</SelectLabel>
                            {EDGE_VOICES.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.label} · {v.gender}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground">ZAI bawaan · cadangan</SelectLabel>
                            {ZAI_VOICES.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={previewVoice}
                        className="h-9 shrink-0 px-2.5"
                        title="Dengar contoh suara"
                      >
                        {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>

                {mode === "A" ? (
                  <>
                    <Button
                      onClick={generateProposal}
                      disabled={loading || prodPhase === "assets" || prodPhase === "render"}
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
                      {clipCount} klip × ±{perClipSeconds} detik · narasi ±{Math.round(durationSeconds * 2.2)} kata
                    </p>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={produceVideo}
                      disabled={prodPhase === "assets" || prodPhase === "render"}
                      className="w-full bg-amber-500 text-stone-950 hover:bg-amber-400"
                    >
                      {prodPhase === "assets" || prodPhase === "render" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Autopilot sedang bekerja…
                        </>
                      ) : (
                        <>
                          <Zap className="mr-2 h-4 w-4" /> Buat Video Langsung (Satu Klik)
                        </>
                      )}
                    </Button>
                    <p className="text-center text-[11px] text-muted-foreground">
                      Naskah, narasi TTS, animasi canvas, subtitle — semuanya otomatis di server.
                    </p>
                  </>
                )}

                <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  {status?.geminiKeyPresent
                    ? "Mesin naskah: Gemini aktif (key terpasang)"
                    : "Mesin naskah: ZAI bawaan — pasang key Gemini di panel Status untuk kualitas terbaik"}
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

                  {proposal.score && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-amber-500" />
                        <span className="text-sm font-semibold">Penilaian AI</span>
                        <Badge className={proposal.score.total >= 75 ? "bg-green-600 text-white" : proposal.score.total >= 60 ? "bg-amber-500 text-stone-950" : "bg-red-600 text-white"}>
                          Skor {proposal.score.total}/100
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                        {([
                          ["Hook 3 detik pertama", proposal.score.hook],
                          ["Alur cerita", proposal.score.story],
                          ["Potensi retensi", proposal.score.retensi],
                          ["Klaritas pesan", proposal.score.klaritas],
                        ] as const).map(([label, val]) => (
                          <div key={label}>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>{label}</span>
                              <span className="font-mono">{val}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-800">
                              <div
                                className={`h-full rounded-full ${val >= 75 ? "bg-green-500" : val >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                                style={{ width: `${Math.max(3, val)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      {proposal.score.tips.length > 0 && (
                        <div className="mt-3 space-y-1 border-t border-border/60 pt-2.5">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Saran perbaikan</p>
                          {proposal.score.tips.map((t, i) => (
                            <p key={i} className="text-xs leading-relaxed text-muted-foreground">• {t}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

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

                  {prodPanel}
                </div>
              )}

              {/* Mode B / restore riwayat: panel produksi tanpa proposal */}
              {!loading && !proposal && prodPhase !== "idle" && (
                <div className="space-y-4">{prodPanel}</div>
              )}
            </div>
          </div>
        </section>

        {/* HISTORY */}
        <section id="riwayat" className="border-t border-border/60 scroll-mt-14">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                  <History className="h-6 w-6 text-amber-500" /> Riwayat Produksi
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tersimpan di database server — aman dari refresh browser. Klik untuk membuka kembali hasilnya.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={loadHistory}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Segarkan
              </Button>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center">
                  <Film className="h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Belum ada produksi. Hasil video Anda akan muncul di sini setelah dibuat.
                  </p>
                </div>
              )}
              {history.map((h) => (
                <button
                  key={h.jobId}
                  type="button"
                  onClick={() => restoreProduction(h)}
                  className="rounded-xl border border-border/70 bg-background p-4 text-left transition-colors hover:border-amber-500/50 hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <Badge className={h.mode === "B" ? "bg-sky-500 text-stone-950" : "bg-amber-500 text-stone-950"}>
                      {h.mode === "B" ? "Autopilot" : "Director"}
                    </Badge>
                    {h.status === "done" && (
                      <Badge variant="outline" className="border-green-500/50 text-green-500">Selesai</Badge>
                    )}
                    {h.status === "running" && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-500">Berjalan</Badge>
                    )}
                    {h.status === "error" && (
                      <Badge variant="outline" className="border-red-500/50 text-red-500">Gagal</Badge>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-semibold">{h.title}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {h.styleCode} · {h.ratio}
                    {h.durationSec ? ` · ${Math.round(h.durationSec)} dtk` : ""}
                    {` · ${new Date(h.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                  </p>
                </button>
              ))}
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
                  <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
                    <div className="flex items-center gap-3">
                      {isCrossOriginBackend() ? (
                        <CircleCheck className="h-5 w-5 shrink-0 text-green-500" />
                      ) : (
                        <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" />
                      )}
                      <span className="text-sm font-medium">Server produksi (backend video)</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {isCrossOriginBackend()
                        ? <>API diarahkan ke <code className="rounded bg-stone-800 px-1 py-0.5">{getBackendOrigin()}</code></>
                        : "Frontend & API berjalan di origin yang sama. Jika frontend ini di-host terpisah (mis. Vercel), isi URL server produksi di bawah — server bisa butuh ±1 menit untuk menyala saat pertama dibuka."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        value={backendInput}
                        onChange={(e) => setBackendInput(e.target.value)}
                        placeholder="https://preview-xxxx.space-z.ai"
                        className="h-8 max-w-md flex-1 text-xs"
                      />
                      <Button size="sm" className="h-8" onClick={saveBackendOrigin}>
                        {backendSaved ? "Tersimpan ✓" : "Simpan"}
                      </Button>
                    </div>
                  </div>
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
                      {status.edgeTts?.ok ? (
                        <CircleCheck className="h-5 w-5 shrink-0 text-green-500" />
                      ) : (
                        <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" />
                      )}
                      <span className="text-sm font-medium">TTS narasi — Microsoft Edge Neural</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={status.edgeTts?.ok ? "border-green-500/40 text-green-500" : "border-amber-500/40 text-amber-500"}
                    >
                      {status.edgeTts?.detail ?? "Memeriksa…"}
                    </Badge>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {status.geminiKeyPresent ? (
                          <CircleCheck className="h-5 w-5 shrink-0 text-green-500" />
                        ) : (
                          <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" />
                        )}
                        <span className="text-sm font-medium">Layanan image generation (Gemini)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={status.geminiKeyPresent ? "border-green-500/40 text-green-500" : "border-amber-500/40 text-amber-500"}
                        >
                          {status.geminiKeyPresent
                            ? `Key terdeteksi${status.geminiKeyMasked ? ` · ${status.geminiKeyMasked}` : ""}`
                            : "Belum dikonfigurasi"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            setShowKeyEditor((v) => !v);
                            setGeminiMsg(null);
                          }}
                        >
                          <KeyRound className="mr-1 h-3 w-3" />
                          {showKeyEditor ? "Tutup" : "Atur di web"}
                        </Button>
                      </div>
                    </div>

                    {showKeyEditor && (
                      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                        {status.geminiKeyPresent && status.geminiKeyMasked && (
                          <p className="text-xs text-muted-foreground">
                            Key tersimpan ({status.geminiKeySource === "env" ? "dari file .env" : "dari web"}):{" "}
                            <code className="rounded bg-stone-800 px-1.5 py-0.5">{status.geminiKeyMasked}</code> — tempel
                            key baru untuk menggantinya.
                          </p>
                        )}
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            type="password"
                            autoComplete="off"
                            placeholder="Tempel Gemini API key (AIza…)"
                            value={geminiInput}
                            onChange={(e) => setGeminiInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !geminiBusy) saveGeminiKeyAction();
                            }}
                          />
                          <div className="flex gap-2">
                            <Button
                              onClick={saveGeminiKeyAction}
                              disabled={geminiBusy || !geminiInput.trim()}
                              className="bg-amber-500 text-stone-950 hover:bg-amber-400"
                            >
                              {geminiBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Simpan
                            </Button>
                            {status.geminiKeyPresent && status.geminiKeySource !== "env" && (
                              <Button variant="destructive" onClick={clearGeminiKeyAction} disabled={geminiBusy}>
                                Hapus
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Key disimpan di server ini, hanya tampil tersamar, dan langsung dipakai tanpa restart. Dipakai
                          untuk mode Autopilot skill (image gen &amp; speech Gemini) — Studio di halaman ini tidak
                          memerlukannya.
                        </p>
                        {geminiMsg && (
                          <p
                            className={
                              geminiMsg.kind === "error"
                                ? "text-xs text-red-500"
                                : geminiMsg.kind === "warn"
                                  ? "text-xs text-amber-500"
                                  : "text-xs text-green-500"
                            }
                          >
                            {geminiMsg.text}
                          </p>
                        )}
                      </div>
                    )}
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
