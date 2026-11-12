import ZAI from "z-ai-web-dev-sdk";

const STAGE_RULES = `You are a professional stickman video director. Produce a "Phase A" director's proposal JSON.

RULES:
1. Structure the clips through the 5-Stage High-Completion Heartbeat Engine: Golden Hook -> Disrupting Assumptions -> Unveiling Insider Secrets -> Ultimate Truth Revelation -> Elevation & Discussion. Clip 1 opens with a counter-intuitive hook in the first 2-5 seconds. The final clip ends with a memorable punchline plus a discussion prompt.
2. narrationEn: English narration at 20-25 words per 10-second clip. narrationId: natural Indonesian translation.
3. Narration is AUDIO ONLY (no on-screen text, no speech bubbles).
4. Each clip: exactly 3 timed beats "[0-3s] ...", "[3-7s] ...", "[7-10s] ...", at least 4 concrete visual devices, action-driven motion (no idle character, no abstract morphing).
5. One consistent narrator and main character across clips.
6. No invented statistics. No hex/RGB notation. Never use the double-quote character inside string values.
7. title, logline, voiceProfile, bgm, beats, devices, transition in Indonesian. narrationEn in English.
8. Return ONLY valid JSON, no markdown fences:
{"title":string,"logline":string,"voiceProfile":string,"bgm":string,"clips":[{"index":number,"stage":string,"time":string,"narrationEn":string,"narrationId":string,"beats":string[3],"devices":string[4+],"transition":string}]}`;

async function make(zai, user) {
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: STAGE_RULES },
      { role: "user", content: user },
    ],
    thinking: { type: "disabled" },
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1));
}

const zai = await ZAI.create();

const out1 = await make(
  zai,
  `Gaya visual: A1 — Hitam Putih Klasik (Klasik Minimalis). Rasio: 16:9. Durasi: 60 detik = 6 klip.\n\nTopik:\nMengapa manusia prokrastinasi menurut sains`
);
console.log("A1_OK");
console.log(JSON.stringify(out1));

const out2 = await make(
  zai,
  `Gaya visual: A3 — Gua Prasejarah (Komedi Gelap). Rasio: 16:9. Durasi: 30 detik = 3 klip. Gunakan setup -> eskalasi -> punchline ironis khas komedi gelap prasejarah; jangan dipaksa berakhir dengan pertanyaan diskusi.\n\nTopik:\nSehari dalam hidup manusia gua menemukan api untuk pertama kali`
);
console.log("A3_OK");
console.log(JSON.stringify(out2));
