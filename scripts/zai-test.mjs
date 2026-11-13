import ZAI from "z-ai-web-dev-sdk";
try {
  const zai = await ZAI.create();
  const r = await zai.chat.completions.create({
    messages: [{ role: "user", content: "Balas dengan satu kata: siap" }],
    thinking: { type: "disabled" },
  });
  console.log("ZAI OK:", (r.choices?.[0]?.message?.content ?? "").trim().slice(0, 60));
} catch (e) {
  console.log("ZAI FAIL:", e.message?.slice(0, 200));
}
