import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
let cookie = "";
async function post(path, payload, expected = 200, extra = {}) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookie,
      ...extra,
    },
    body: JSON.stringify(payload),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
await post("/api/session", { action: "new", mode: "demo" }, 400);
const config = await fetch(base + "/api/config").then((r) => r.json());
if (!config.ai) {
  await post("/api/session", { action: "new", mode: "live" }, 503);
  console.log(
    "PASS: demo removed; missing API configuration blocks new games.",
  );
  process.exit(0);
}
let s = await post("/api/session", { action: "new", mode: "live" });
assert.equal(s.state.mode, "live");
const original = s.token;
await post(
  "/api/session",
  { action: "load", token: original.slice(0, -3) + "bad" },
  400,
);
await post("/api/session", { action: "load", token: original }, 403, {
  Cookie: "live-device=another-device",
});
await post("/api/session", { action: "load", token: original }, 403, {
  Origin: "https://untrusted.example",
});
await post("/api/analyze", { token: original, message: "" }, 400);
await post("/api/memory", { token: original, action: "reveal" }, 400);
assert.ok(
  (await post("/api/memory", { token: original })).memories.every(
    (m) => !m.unlocked,
  ),
);
const defs = JSON.parse(
  await readFile(new URL("../story/memories.json", import.meta.url), "utf8"),
);
let turns = 0;
let fallbacks = 0;
for (const memory of defs) {
  for (let i = 0; i < 6; i++) {
    const message =
      memory.keywords.slice(0, 5).join("、") +
      `。あの頃、そんな仕事や情景があったと思う。${i}つ目の場面はどう感じた？`;
    s = await post("/api/analyze", { token: s.token, message });
    turns++;
    if (s.warning) fallbacks++;
    assert.ok(s.gain <= 100);
    if (s.state.memories.find((m) => m.id === memory.id).unlocked) break;
  }
}
console.log(`Analysis fallback turns: ${fallbacks}/${turns}`);
assert.equal(s.state.completed, true);
assert.equal(s.state.memories.filter((m) => m.unlocked).length, 5);
assert.equal(
  (await post("/api/session", { action: "load", token: s.token })).state
    .completed,
  true,
);
const saved = await post("/api/session", { action: "save", token: s.token });
assert.equal(saved.cloud, false);
assert.equal(
  (await post("/api/memory", { token: s.token })).memories.length,
  5,
);
console.log(
  `PASS: ${turns} content-driven turns, five memories, ending, resume, local save, tamper/device/origin/input checks, removed demo and timed reveal rejection.`,
);
