// Drives the game in headless Edge over CDP to confirm the voice-first flow,
// the microphone fallback, and the opening guide. Local verification only.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const EDGE =
  process.env.EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "live-ui-"));

const edge = spawn(EDGE, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1440,1000",
  "--no-first-run",
  "--disable-gpu",
  "--use-fake-ui-for-media-stream=deny",
  "about:blank",
]);
edge.on("error", (e) => {
  console.error("Edge failed to launch:", e.message);
  process.exit(1);
});

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
        r.json(),
      );
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* keep waiting for the debugger port */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("No debuggable page");
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
const logs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    logs.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Runtime.exceptionThrown")
    logs.push(
      "EXCEPTION " + msg.params.exceptionDetails.exception?.description,
    );
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = join(profile, name + ".png");
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log("  screenshot:", file);
  return file;
};

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

console.log("\n== home ==");
await send("Page.navigate", { url: BASE });
await wait(2500);
check("title renders", (await evaluate(`document.querySelector("h1")?.textContent`)) === "LIVE");

console.log("\n== opening guide ==");
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll("button")]
      .find(x => x.className.includes("start-button"));
    b?.click();
    return !!b;
  })()
`);
await wait(2500);
const guide = await evaluate(`
  (() => {
    const d = document.querySelector("dialog.modal");
    if (!d) return null;
    return {
      heading: d.querySelector("h3")?.textContent,
      step: d.querySelector(".eyebrow")?.textContent,
      bullets: d.querySelectorAll(".guide-list li").length,
      dots: d.querySelectorAll(".guide-steps i").length,
    };
  })()
`);
check("guide opens before play", !!guide, JSON.stringify(guide));
check("guide has step dots", guide?.dots === 5, `dots=${guide?.dots}`);
check("guide page has bullets", (guide?.bullets ?? 0) >= 3);
await shot("guide-1");

// Walk every page so each one is proven to render.
const headings = [];
for (let i = 0; i < 5; i++) {
  headings.push(
    await evaluate(`document.querySelector("dialog.modal h3")?.textContent`),
  );
  const advanced = await evaluate(`
    (() => {
      const b = [...document.querySelectorAll("dialog.modal .guide-nav button")]
        .find(x => x.textContent.includes("つぎへ"));
      if (!b) return false;
      b.click();
      return true;
    })()
  `);
  if (!advanced) break;
  await wait(350);
}
check("all five guide pages render", headings.filter(Boolean).length === 5, headings.join(" | "));
await shot("guide-last");

console.log("\n== microphone denied: fallback to choices and text ==");
await evaluate(`
  (() => {
    const b = [...document.querySelectorAll("dialog.modal .guide-nav button")]
      .find(x => x.textContent.includes("彼女に会う"));
    b?.click();
    return !!b;
  })()
`);
await wait(3000);
const stage = await evaluate(`
  (() => {
    const suggestions = [...document.querySelectorAll(".suggestions button span:nth-child(2)")]
      .map(s => s.textContent);
    return {
      modal: !!document.querySelector("dialog.modal"),
      dialogue: document.querySelector(".dialogue-box p")?.textContent,
      fallback: document.querySelector(".mic-fallback")?.textContent || null,
      textPanel: !!document.querySelector(".text-panel"),
      input: !!document.querySelector(".message-form input"),
      suggestions,
      mode: document.querySelector(".mode-pill")?.textContent,
    };
  })()
`);
check("guide closes into the game", !stage.modal);
check("she speaks the opening line", !!stage.dialogue, stage.dialogue?.slice(0, 30));
check("typed fallback panel is shown", stage.textPanel && stage.input);
const live = !!stage.mode?.includes("AI");
console.log(`  mode: ${stage.mode?.trim()}`);
if (live)
  // With an API key the game tries the microphone first; a refusal has to be
  // explained right where the player is, next to the typed fallback.
  check(
    "microphone refusal is explained in place",
    !!stage.fallback,
    stage.fallback?.slice(0, 70) ?? "no .mic-fallback",
  );
else
  check(
    "demo mode needs no microphone notice",
    !stage.fallback,
    "text is the way to play",
  );
check("three choices offered", stage.suggestions.length === 3, stage.suggestions.join(" / "));
await shot("game-text-fallback");

console.log("\n== a turn through the choices ==");
const before = await evaluate(`document.querySelector(".dialogue-box p")?.textContent`);
await evaluate(`document.querySelector(".suggestions button")?.click()`);
await wait(3000);
const after = await evaluate(`
  (() => ({
    line: document.querySelector(".dialogue-box p")?.textContent,
    suggestions: [...document.querySelectorAll(".suggestions button span:nth-child(2)")].map(s => s.textContent),
    error: document.querySelector(".error-toast span")?.textContent || null,
  }))()
`);
check("her reply changes after a turn", after.line !== before, after.line?.slice(0, 40));
check("no error toast", !after.error, after.error ?? "");

console.log("\n== repeated turns do not repeat the same reply ==");
const said = [
  "レジでお客さんに、袋はいりますかと聞いていた気がする",
  "怒られて手が震えて、何度も謝っていたのかもしれない",
  "毎日来る常連さんに、温かいコーヒーを渡していたよね",
  "忙しい夜に段ボールを開けて、期限を確認していたでしょう",
];
const lines = [after.line];
for (const message of said) {
  await evaluate(`
    (() => {
      const input = document.querySelector(".message-form input");
      if (!input) return false;
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value").set;
      set.call(input, ${JSON.stringify(message)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".message-form").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  await wait(2600);
  lines.push(await evaluate(`document.querySelector(".dialogue-box p")?.textContent`));
}
const unique = new Set(lines.filter(Boolean)).size;
check("replies vary across turns", unique >= 4, `${unique} distinct of ${lines.length}`);
lines.forEach((l, i) =>
  console.log(`     ${i}: ${l?.split("\n").join(" / ").slice(0, 70)}`),
);
await shot("game-turns");

console.log("\n== help button reopens the full guide ==");
await evaluate(`
  [...document.querySelectorAll(".header-actions button")]
    .find(b => b.getAttribute("aria-label") === "遊び方の説明")?.click()
`);
await wait(700);
check(
  "guide reachable from the header",
  await evaluate(
    `!!document.querySelector("dialog.modal .guide-steps") && !!document.querySelector("dialog.modal .guide-list")`,
  ),
);

console.log("\n== console ==");
const noisy = logs.filter((l) => !/favicon|Download the React DevTools/i.test(l));
check("no console errors", noisy.length === 0, noisy.slice(0, 3).join(" | "));

ws.close();
edge.kill();
console.log(
  `\n${failures ? "FAILURES: " + failures : "ALL UI CHECKS PASSED"}\n`,
);
process.exit(failures ? 1 : 0);
