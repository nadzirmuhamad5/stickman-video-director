// ---------------------------------------------------------------------------
// TTS voice catalog — client-safe pure data (importable from components).
// Two engines are available:
//  - "edge": Microsoft Edge neural TTS (via the local `edge-tts` Python
//    package). Native Indonesian voices (Ardi / Gadis) plus natural English
//    voices. Much better pronunciation for id/en narration.
//  - "zai" : the bundled z-ai-web-dev-sdk voices (tongtong, chuichui, ...).
//    Bilingual Mandarin voices — usable fallback, weaker for id/en.
// ---------------------------------------------------------------------------

export type TtsEngine = "edge" | "zai";

export type TtsVoice = {
  id: string;
  engine: TtsEngine;
  /** narration language this voice fits best */
  lang: "id" | "en";
  gender: "Pria" | "Wanita";
  label: string;
  description: string;
};

/** Voices shown in the UI, Edge voices first (recommended). */
export const TTS_VOICES: TtsVoice[] = [
  // --- Microsoft Edge neural — Indonesian ---
  {
    id: "id-ID-ArdiNeural",
    engine: "edge",
    lang: "id",
    gender: "Pria",
    label: "Ardi (Edge)",
    description: "Narator pria Indonesia — jelas & profesional",
  },
  {
    id: "id-ID-GadisNeural",
    engine: "edge",
    lang: "id",
    gender: "Wanita",
    label: "Gadis (Edge)",
    description: "Narator wanita Indonesia — hangat & ekspresif",
  },
  // --- Microsoft Edge neural — English ---
  {
    id: "en-US-GuyNeural",
    engine: "edge",
    lang: "en",
    gender: "Pria",
    label: "Guy (Edge)",
    description: "English narrator, male — news-style clarity",
  },
  {
    id: "en-US-BrianNeural",
    engine: "edge",
    lang: "en",
    gender: "Pria",
    label: "Brian (Edge)",
    description: "Deep, sincere male narrator — default for B4 Thriller",
  },
  {
    id: "en-US-AndrewNeural",
    engine: "edge",
    lang: "en",
    gender: "Pria",
    label: "Andrew (Edge)",
    description: "Warm, confident male narrator — cinematic tone",
  },
  {
    id: "en-US-JennyNeural",
    engine: "edge",
    lang: "en",
    gender: "Wanita",
    label: "Jenny (Edge)",
    description: "English narrator, female — conversational",
  },
  {
    id: "en-GB-RyanNeural",
    engine: "edge",
    lang: "en",
    gender: "Pria",
    label: "Ryan UK (Edge)",
    description: "British narrator, male",
  },
  // --- z-ai SDK (fallback) ---
  { id: "tongtong", engine: "zai", lang: "id", gender: "Wanita", label: "Tongtong (ZAI)", description: "Suara bawaan — hangat & ramah" },
  { id: "chuichui", engine: "zai", lang: "id", gender: "Wanita", label: "Chuichui (ZAI)", description: "Suara bawaan — ceria" },
  { id: "xiaochen", engine: "zai", lang: "id", gender: "Wanita", label: "Xiaochen (ZAI)", description: "Suara bawaan — kalem profesional" },
  { id: "jam", engine: "zai", lang: "en", gender: "Pria", label: "Jam (ZAI)", description: "Suara bawaan — British" },
  { id: "kazi", engine: "zai", lang: "en", gender: "Pria", label: "Kazi (ZAI)", description: "Suara bawaan — jelas & standar" },
];

export const DEFAULT_VOICE = "id-ID-ArdiNeural";

export function findVoice(voiceId: string): TtsVoice | undefined {
  return TTS_VOICES.find((v) => v.id === voiceId);
}

/** Legacy jobs may hold a bare zai voice id — keep them working. */
export function resolveVoice(voiceId: string): TtsVoice {
  return (
    findVoice(voiceId) ?? {
      id: voiceId,
      engine: "zai" as TtsEngine,
      lang: "id" as const,
      gender: "Wanita" as const,
      label: voiceId,
      description: "Suara bawaan",
    }
  );
}
