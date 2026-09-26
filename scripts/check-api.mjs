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
let s = await post("/api/session", { action: "new", mode: "demo" });
assert.equal(s.state.mode, "demo");
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
await post(
  "/api/live",
  { token: original, sdp: "fake-sdp-for-demo-check" },
  400,
);
const defs = JSON.parse(
  await readFile(new URL("../story/memories.json", import.meta.url), "utf8"),
);
let turns = 0;
for (const memory of defs) {
  for (let i = 0; i < 6; i++) {
    const message =
      memory.keywords.slice(0, 5).join("、") +
      `。あの頃、そんな仕事や情景があったと思う。${i}つ目の場面はどう感じた？`;
    s = await post("/api/analyze", { token: s.token, message });
    turns++;
    assert.ok(s.gain <= 100);
    if (s.state.memories.find((m) => m.id === memory.id).unlocked) break;
  }
}
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
  `PASS: ${turns} demo turns, five memories, ending, resume, local save, tamper/device/origin/input checks, demo voice rejection.`,
);
