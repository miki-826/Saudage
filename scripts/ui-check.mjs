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


try {
  await send("Page.navigate", { url: BASE });
  await wait(2200);
  check("title renders", (await evaluate(`document.querySelector("h1")?.textContent`)) === "LIVE");
  check("demo and continue controls removed", await evaluate(`![...document.querySelectorAll("button")].some(b => /体験モード|つづきから/.test(b.textContent))`));
  await evaluate(`document.querySelector(".start-button")?.click()`);
  await wait(1400);
  check("guide opens", await evaluate(`!!document.querySelector(".guide-list")`));
  await evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("説明を飛ばす"))?.click()`);
  await wait(1600);
  check("text fallback available", await evaluate(`!!document.querySelector(".message-form input")`));
  check("exit is visible", await evaluate(`!!document.querySelector(".exit-game-button")`));
  await evaluate(`(() => {
    const input = document.querySelector(".message-form input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "お店");
    input.dispatchEvent(new Event("input", {bubbles: true}));
    document.querySelector(".message-form").dispatchEvent(new Event("submit", {bubbles:true, cancelable:true}));
  })()`);
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`!!document.querySelector(".unlock-scene")`)) break;
    await wait(1000);
  }
  await shot("content-memory");
  const modalText = await evaluate(`document.querySelector("dialog.modal")?.textContent || ""`);
  check("shop topic opens memory", /コンビニ/.test(modalText), modalText.slice(0,100));
  await evaluate(`document.querySelector("dialog.modal")?.dispatchEvent(new Event("cancel", {cancelable:true}))`);
  await wait(500);
  const token = await evaluate(`localStorage.getItem("live-save-v1")`);
  const beforeHint = await evaluate(`document.querySelector(".dialogue-box p")?.textContent`);
  await wait(32000);
  check("time does not update memories", token === await evaluate(`localStorage.getItem("live-save-v1")`));
  check("time shows hint only", await evaluate(`!!document.querySelector(".hint-mark")`));
  check("hint changes dialogue", beforeHint !== await evaluate(`document.querySelector(".dialogue-box p")?.textContent`));
  await send("Emulation.setDeviceMetricsOverride", {width:390, height:844, deviceScaleFactor:1, mobile:true});
  await wait(700);
  check("mobile exit stays in viewport", await evaluate(`(() => { const r=document.querySelector(".exit-game-button")?.getBoundingClientRect(); return !!r && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight; })()`));
  await shot("mobile-exit-and-hint");
  await evaluate(`document.querySelector(".exit-game-button")?.click()`);
  await wait(500);
  check("exit returns home", await evaluate(`!!document.querySelector(".home-hero") && !document.querySelector(".game-stage")`));
  check("no console exceptions", !logs.some(l => l.startsWith("EXCEPTION")), logs.filter(l => l.startsWith("EXCEPTION")).join(" | "));
} finally {
  ws.close();
  edge.kill();
}
console.log(failures ? `FAILURES: ${failures}` : "ALL UI CHECKS PASSED");
process.exit(failures ? 1 : 0);
