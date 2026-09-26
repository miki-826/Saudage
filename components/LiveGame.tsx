"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowRight,
  BookOpen,
  Volume2,
  VolumeX,
  Settings2,
  Mic,
  MicOff,
  Send,
  Feather,
  ChevronRight,
  Check,
  Lock,
  Camera,
  MessageCircle,
  Download,
  Upload,
  RotateCcw,
  Headphones,
  Sparkles,
  Home,
} from "lucide-react";
import {
  memories,
  focusMemory,
  tone,
  type GameState,
  type VisualSignals,
  type Memory,
} from "@/lib/game/engine";
import story from "@/story/story.json";
import { Modal } from "./Modal";
import { CameraTracker } from "./CameraTracker";
import { LiveConnection } from "@/lib/client/live";

type Config = { ai: boolean; cloud: boolean; accessCode: boolean };
type Session = { token: string; state: GameState };
type Turn = Session & {
  reply: string;
  unlocked: string | null;
  gain: number;
  context: string;
  warning?: string;
};
type Prefs = {
  sound: boolean;
  volume: number;
  camera: boolean;
  motion: boolean;
  code: string;
};
const defaults: Prefs = {
  sound: false,
  volume: 0.28,
  camera: false,
  motion: true,
  code: "",
};
const saveKey = "live-save-v1";
function Ornament() {
  return (
    <div className="ornament" aria-hidden="true">
      <span />✧<span />
    </div>
  );
}
async function api<T>(path: string, data: unknown, code = ""): Promise<T> {
  const result = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-game-code": code },
    body: JSON.stringify(data),
  });
  const body = await result.json();
  if (!result.ok) throw new Error(body.error || "接続できませんでした。");
  return body;
}

export function LiveGame({
  initialContinue = false,
}: {
  initialContinue?: boolean;
}) {
  const [config, setConfig] = useState<Config>({
    ai: false,
    cloud: false,
    accessCode: false,
  });
  const [session, setSession] = useState<Session | null>(null),
    [screen, setScreen] = useState<"home" | "game" | "ending">("home");
  const [modal, setModal] = useState<
      "settings" | "memory" | "about" | "restart" | "history" | null
    >(null),
    [selected, setSelected] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(defaults),
    [hasSave, setHasSave] = useState(false),
    [busy, setBusy] = useState(false),
    [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [line, setLine] = useState(story.opening),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [unlock, setUnlock] = useState<Memory | null>(null);
  const [voice, setVoice] = useState<"off" | "connecting" | "on">("off"),
    [cameraReady, setCameraReady] = useState(false),
    [hintLevel, setHintLevel] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null),
    live = useRef<LiveConnection | null>(null),
    current = useRef<Session | null>(null),
    prefsRef = useRef(prefs);
  const locked = useRef(false),
    signals = useRef<VisualSignals | null>(null),
    lastProgress = useRef(0),
    hintCount = useRef(0),
    queue = useRef<string[]>([]),
    file = useRef<HTMLInputElement>(null);
  const processRef = useRef<(text: string, isVoice?: boolean) => Promise<void>>(
    async () => {},
  );
  const onError = useCallback((text: string) => setError(text), []);
  const onSignals = useCallback((s: VisualSignals | null) => {
    signals.current = s;
    setCameraReady(!!s);
  }, []);
  function stopVoice() {
    live.current?.stop();
    setVoice("off");
  }
  function persist(data: Session) {
    current.current = data;
    setSession(data);
    try {
      localStorage.setItem(saveKey, data.token);
      setHasSave(true);
    } catch {
      setError(
        "端末に保存できませんでした。設定からセーブを書き出してください。",
      );
    }
  }
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => {
    let active = true;
    void fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => {
        if (active)
          setError(
            "接続設定を確認できませんでした。ページを再読み込みしてください。",
          );
      });
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = JSON.parse(
          localStorage.getItem("live-preferences") || "null",
        );
        if (stored)
          setPrefs({
            ...defaults,
            sound: !!stored.sound,
            volume: Math.max(
              0,
              Math.min(
                1,
                Number.isFinite(stored.volume) ? stored.volume : 0.28,
              ),
            ),
            motion: stored.motion !== false,
            camera: false,
          });
        const token = localStorage.getItem(saveKey);
        setHasSave(!!token);
        if (initialContinue && token) {
          void api<Session>("/api/session", { action: "load", token })
            .then((data) => {
              if (active) {
                current.current = data;
                setSession(data);
                setLine(data.state.history.at(-1)?.content || story.opening);
                setScreen(data.state.completed ? "ending" : "game");
              }
            })
            .catch((e) => {
              if (active) setError(e.message);
            });
        }
      } catch {
        /* An unavailable browser store does not prevent a new game. */
      }
      setHydrated(true);
    });
    return () => {
      active = false;
      live.current?.dispose();
    };
  }, [initialContinue]);
  useEffect(() => {
    const el = audio.current;
    if (el) {
      el.volume = prefs.volume;
      if (prefs.sound) {
        void el
          .play()
          .catch(() =>
            setNotice(
              "音を再生するには、もう一度サウンドボタンを押してください。",
            ),
          );
      } else el.pause();
    }
    if (hydrated)
      try {
        localStorage.setItem(
          "live-preferences",
          JSON.stringify({ ...prefs, code: "", camera: false }),
        );
      } catch {}
  }, [prefs, hydrated]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (screen !== "game" || busy || unlock || modal) return;
    const interval = setInterval(() => {
      const s = current.current;
      if (
        !s ||
        s.state.completed ||
        Date.now() - lastProgress.current < 30000 ||
        hintCount.current >= 3
      )
        return;
      const hint = focusMemory(s.state).hints[hintCount.current];
      setLine(hint);
      live.current?.hint(hint);
      hintCount.current++;
      setHintLevel(hintCount.current);
      lastProgress.current = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, busy, unlock, modal]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        live.current?.stop();
        setVoice("off");
        setPrefs((p) => ({ ...p, camera: false }));
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  async function start(mode: "demo" | "live") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      stopVoice();
      const data = await api<Session>("/api/session", { action: "new", mode });
      persist(data);
      setLine(story.opening);
      setScreen("game");
      setModal(null);
      setHintLevel(0);
      hintCount.current = 0;
      lastProgress.current = Date.now();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function resume() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const token = localStorage.getItem(saveKey);
      const data = await api<Session>("/api/session", {
        action: "load",
        token: token || undefined,
      });
      persist(data);
      setLine(data.state.history.at(-1)?.content || story.opening);
      setScreen(data.state.completed ? "ending" : "game");
      lastProgress.current = Date.now();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function chime() {
    try {
      const ctx = new AudioContext();
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(
          0.045 * prefsRef.current.volume,
          ctx.currentTime + i * 0.15 + 0.03,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + i * 0.15 + 1.6,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + 2);
      });
      setTimeout(() => void ctx.close(), 2400);
    } catch {}
  }
  async function process(text: string, isVoice = false) {
    if (!text.trim() || !current.current) return;
    if (locked.current) {
      if (isVoice) queue.current.push(text);
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<Turn>(
        "/api/analyze",
        {
          token: current.current.token,
          message: text,
          voice: isVoice,
          signals: signals.current,
        },
        prefsRef.current.code,
      );
      persist(result);
      if (!isVoice || result.unlocked || result.state.completed)
        setLine(result.reply);
      setInput("");
      if (result.gain) {
        lastProgress.current = Date.now();
        hintCount.current = 0;
        setHintLevel(0);
      }
      if (result.warning) setNotice(result.warning);
      live.current?.update(
        result.context,
        result.unlocked ? result.reply : null,
      );
      if (result.unlocked) {
        setModal(null);
        setUnlock(memories.find((m) => m.id === result.unlocked)!);
        live.current?.pauseForMemory();
        if (prefsRef.current.sound) chime();
      } else if (result.state.completed) {
        stopVoice();
        setScreen("ending");
      }
    } catch (e) {
      setError((e as Error).message);
      if (isVoice) setInput(text);
    } finally {
      locked.current = false;
      setBusy(false);
      const next = queue.current.shift();
      if (next) void processRef.current(next, true);
    }
  }
  useEffect(() => {
    processRef.current = process;
  });
  async function toggleVoice() {
    if (voice !== "off") {
      stopVoice();
      return;
    }
    if (!session) return;
    if (session.state.mode === "demo") {
      setNotice(
        "体験モードはテキストで遊べます。API設定後、新しい物語から音声会話を始められます。",
      );
      return;
    }
    setVoice("connecting");
    setError("");
    const connection = new LiveConnection({
      onReady: () => setVoice("on"),
      onInput: (t) => {
        void processRef.current(t, true);
      },
      onOutput: setLine,
      onError: setError,
      onClosed: () => setVoice("off"),
    });
    live.current = connection;
    try {
      await connection.start(session.token, prefs.code);
    } catch (e) {
      setError((e as Error).message);
      setVoice("off");
    }
  }
  async function save() {
    if (!session || busy) return;
    try {
      const data = await api<Session & { cloud: boolean }>("/api/session", {
        action: "save",
        token: session.token,
      });
      setNotice(
        data.cloud
          ? "この端末とクラウドに記憶を保存しました。"
          : "この端末に記憶を保存しました。",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function closeUnlock() {
    setUnlock(null);
    if (state?.completed) {
      stopVoice();
      setScreen("ending");
    } else {
      live.current?.resumeAfterMemory();
      live.current?.hint(line);
    }
  }
  function exportSave() {
    if (!session) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, token: session.token })], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "live-memory.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importSave(f: File) {
    try {
      if (f.size > 60000) throw new Error("セーブファイルが大きすぎます。");
      const { token } = JSON.parse(await f.text());
      const data = await api<Session>("/api/session", {
        action: "load",
        token,
      });
      stopVoice();
      persist(data);
      setLine(data.state.history.at(-1)?.content || story.opening);
      setScreen(data.state.completed ? "ending" : "game");
      setModal(null);
      setNotice("記憶を読み込みました。");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const state = session?.state,
    count = state?.memories.filter((m) => m.unlocked).length ?? 0,
    focus = state ? focusMemory(state) : memories[0];
  const currentTone = state ? tone(state) : null;
  const detail = memories.find((m) => m.id === selected),
    detailState = state?.memories.find((m) => m.id === selected);

  return (
    <main
      className={`world ${screen} ${!prefs.motion ? "reduced-motion" : ""}`}
    >
      <div className="world-background" />
      <div className="world-shade" />
      <div className="rain" aria-hidden="true" />
      <div className="motes" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <i
            key={i}
            style={{
              left: `${8 + i * 7.5}%`,
              animationDelay: `${i * 0.8}s`,
              animationDuration: `${9 + (i % 4)}s`,
            }}
          />
        ))}
      </div>
      <audio ref={audio} src="/sounds/streetlight.mp4" loop preload="none" />
      <header className="site-header">
        <button
          className="wordmark"
          aria-label="LIVE ホーム"
          onClick={() => {
            stopVoice();
            setScreen("home");
          }}
        >
          LIVE<span>忘れた心に、灯りを。</span>
        </button>
        <nav aria-label="メインナビゲーション">
          <button
            className={screen === "home" ? "active" : ""}
            onClick={() => {
              stopVoice();
              setScreen("home");
            }}
          >
            ホーム
          </button>
          <button
            onClick={() => void resume()}
            disabled={busy || (!hasSave && !config.cloud)}
          >
            つづきから
          </button>
          <button onClick={() => setModal("about")}>この物語について</button>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button sound-button"
            onClick={() => setPrefs((p) => ({ ...p, sound: !p.sound }))}
            aria-label={prefs.sound ? "サウンドをオフ" : "サウンドをオン"}
          >
            {prefs.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="icon-button"
            aria-label="設定"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={19} />
          </button>
          <button className="memory-button" onClick={() => setModal("memory")}>
            <BookOpen size={18} />
            <span>記憶のかけら</span>
            <small>
              {count} / {memories.length}
            </small>
          </button>
        </div>
      </header>

      {screen === "home" && (
        <>
          <section className="home-hero">
            <div className="chapter-mark">
              <span>CHAPTER 01</span>
              <i />
              <span>A LIGHT IN THE RAIN</span>
            </div>
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="tiny-star">✧</span> 言葉で、心がほどけていく。
              </p>
              <h1>LIVE</h1>
              <Ornament />
              <h2>
                忘れていた心に、
                <br />
                もう一度、灯りを。
              </h2>
              <p className="hero-description">
                雨の降る、どこか懐かしいこの街で。
                <br />
                あなたの言葉が、彼女の記憶を灯す。
                <br />
                これは、話すことで紡がれていく心の物語。
              </p>
              <button
                className="start-button"
                disabled={busy}
                onClick={() =>
                  hasSave
                    ? setModal("restart")
                    : void start(config.ai ? "live" : "demo")
                }
              >
                <span className="button-star">✧</span>
                <span>
                  {busy ? "物語を開いています…" : "物語をはじめる"}
                  <small>BEGIN YOUR STORY</small>
                </span>
                <ArrowRight size={21} />
              </button>
              <button
                className="continue-button"
                onClick={() => void resume()}
                disabled={busy || (!hasSave && !config.cloud)}
              >
                つづきから <ChevronRight size={15} />
              </button>
              <p className="play-note">
                <Headphones size={13} /> 音声でも、文字でも。あなたのペースで。
              </p>
            </div>
            <div className="side-quote">
              あなたの言葉を、
              <br />
              　　待っている人がいます。
            </div>
            <div className="encounter-card">
              <img
                src="/images/character.webp"
                alt="街灯の下で記憶を探す、名前のない彼女"
              />
              <div>
                <span className="eyebrow">SOMEWHERE IN HER MEMORY</span>
                <p>「……あなたは、私を知っていますか？」</p>
                <span className="muted">
                  名前も、昨日も。まだ、思い出せない。
                </span>
              </div>
              <span className="card-spark">✧</span>
            </div>
          </section>
          <footer className="home-footer">
            <span>AN INTERACTIVE AI STORY</span>
            <span>
              <i className="status-dot" />
              {config.ai
                ? "あなたとの会話から、物語が動きだす。"
                : "体験モード · API設定なしで遊べます"}
            </span>
            <button onClick={() => setModal("about")}>
              遊び方 <ArrowRight size={14} />
            </button>
          </footer>
        </>
      )}

      {screen === "game" && state && (
        <section className="game-stage">
          <div className="game-topline">
            <span className="eyebrow">
              CHAPTER 01 <span className="slash">/</span> {story.title}
            </span>
            <span className="mode-pill">
              <i className="status-dot" />
              {state.mode === "demo" ? "体験モード" : "AI会話"}
              {voice === "on" ? " · 音声接続中" : ""}
            </span>
          </div>
          <div className="conversation-layout">
            <aside className="character-panel">
              <div className={`character-frame stage-${currentTone?.index}`}>
                <img
                  src="/images/character.webp"
                  alt="記憶を取り戻していく彼女"
                />
                <div className="portrait-vignette" />
                <span className="portrait-corner top" />
                <span className="portrait-corner bottom" />
                <div className="character-caption">
                  <span className="eyebrow">HER HEART IS REMEMBERING</span>
                  <h2>{currentTone?.label}</h2>
                  <div className="heart-dots">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <i
                        key={i}
                        className={i <= (currentTone?.index ?? 0) ? "lit" : ""}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <p className="character-note">小さな言葉が、記憶の灯りになる。</p>
            </aside>
            <div className="conversation-panel">
              <div className="conversation-heading">
                <span>
                  <i className="status-dot" />
                  {busy
                    ? "記憶をたどっています"
                    : voice === "on"
                      ? "あなたの声を聴いています"
                      : "あなたの言葉を待っています"}
                </span>
                <button
                  onClick={() => setModal("history")}
                  aria-label="会話の履歴"
                >
                  <MessageCircle size={16} />
                  <span>会話の記録</span>
                </button>
              </div>
              <div className={`dialogue-box ${busy ? "thinking" : ""}`}>
                <div className="speaker">
                  <span>✧</span>{" "}
                  {count >= 4 ? "心を取り戻した彼女" : "名前のない彼女"}
                </div>
                <p aria-live="polite">{line}</p>
                <span className="dialogue-leaf" aria-hidden="true">
                  ❧
                </span>
              </div>
              <div className="reply-area">
                <div className="reply-label">
                  <Feather size={14} />
                  <span>言葉を、届ける</span>
                  <span className="hairline" />
                </div>
                <div className="suggestions">
                  {focus.suggestions.map((text, i) => (
                    <button
                      key={text}
                      disabled={busy || voice !== "off"}
                      onClick={() => void process(text)}
                    >
                      <span className="suggestion-number">0{i + 1}</span>
                      <span>{text}</span>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void process(input);
                  }}
                  className="message-form"
                >
                  <Feather size={17} />
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={busy || voice !== "off"}
                    maxLength={1500}
                    aria-label="彼女に届けるメッセージ"
                    placeholder="あなたの言葉で、話しかけてみて…"
                  />
                  <button
                    disabled={busy || !input.trim() || voice !== "off"}
                    aria-label="メッセージを送信"
                  >
                    <Send size={19} />
                  </button>
                </form>
                <div className="voice-controls">
                  <button
                    className={`mic-button ${voice === "on" ? "listening" : ""}`}
                    onClick={() => void toggleVoice()}
                    disabled={busy || voice === "connecting"}
                  >
                    {voice === "on" ? <MicOff size={18} /> : <Mic size={18} />}
                    <span>
                      {voice === "connecting"
                        ? "接続しています…"
                        : voice === "on"
                          ? "音声会話を終了"
                          : "声で話しかける"}
                    </span>
                    {voice === "on" && (
                      <span className="wave-bars">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <i key={i} />
                        ))}
                      </span>
                    )}
                  </button>
                  <button
                    className={`camera-button ${prefs.camera ? "enabled" : ""}`}
                    aria-label={
                      prefs.camera ? "カメラ補助をオフ" : "カメラ補助をオン"
                    }
                    onClick={() =>
                      setPrefs((p) => ({ ...p, camera: !p.camera }))
                    }
                  >
                    <Camera size={18} />
                    <span>
                      {prefs.camera
                        ? cameraReady
                          ? "補助中"
                          : "準備中"
                        : "カメラ任意"}
                    </span>
                  </button>
                </div>
                <p className="conversation-tip">
                  正解を急がず、情景や気持ちを一緒にたどってみてください。
                </p>
                {hintLevel > 0 && (
                  <span className="hint-mark">
                    記憶の手がかりが浮かんでいます
                  </span>
                )}
              </div>
            </div>
          </div>
          <footer className="game-footer">
            <span>
              MEMORY <b>{String(count).padStart(2, "0")}</b> /{" "}
              {String(memories.length).padStart(2, "0")}
            </span>
            <div className="memory-trail">
              {state.memories.map((m) => (
                <button
                  key={m.id}
                  className={
                    m.unlocked ? "restored" : m.stage > 0 ? "fragment" : ""
                  }
                  onClick={() => {
                    setSelected(m.id);
                    setModal("memory");
                  }}
                  aria-label={
                    m.unlocked
                      ? memories.find((x) => x.id === m.id)?.title
                      : "未解放の記憶"
                  }
                >
                  {m.unlocked ? <Sparkles size={15} /> : <span>✧</span>}
                </button>
              ))}
            </div>
            <button onClick={() => void save()}>
              <Check size={14} /> 記憶を保存
            </button>
          </footer>
        </section>
      )}

      {screen === "ending" && (
        <section className="ending-panel">
          <p className="eyebrow">IDENTITY RESTORED</p>
          <Ornament />
          <h1>
            これが、
            <br />
            私だった。
          </h1>
          <div className="ending-portrait">
            <img src="/images/character.webp" alt="心を取り戻した彼女" />
          </div>
          <p className="ending-story">{story.ending}</p>
          <Ornament />
          <p className="ending-thanks">
            あなたの言葉が、ひとつの心を灯しました。
          </p>
          <div className="ending-actions">
            <button className="gold-button" onClick={() => setModal("memory")}>
              <BookOpen size={17} />
              記憶を振り返る
            </button>
            <button
              className="outline-button"
              onClick={() => {
                stopVoice();
                setScreen("home");
              }}
            >
              <Home size={17} />
              ホームへ
            </button>
          </div>
        </section>
      )}

      {prefs.camera && screen === "game" && (
        <CameraTracker onSignals={onSignals} onError={onError} />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="通知を閉じる">
            ×
          </button>
        </div>
      )}

      {modal === "settings" && (
        <Modal title="あなたのペースで" onClose={() => setModal(null)}>
          <p className="modal-description">
            心地よく物語を楽しむための、小さな設定。
          </p>
          <div className="settings-list">
            <Setting
              label="サウンド"
              description="提供楽曲「Streetlight on Cobblestone」を再生"
              icon={<Volume2 size={19} />}
              checked={prefs.sound}
              onChange={() => setPrefs((p) => ({ ...p, sound: !p.sound }))}
            />
            <label className="volume-setting">
              <span>BGM 音量</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={prefs.volume}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))
                }
              />
              <small>{Math.round(prefs.volume * 100)}%</small>
            </label>
            <Setting
              label="カメラで会話をサポート"
              description="会話中のみ使用。映像は送信せず、動きの数値だけを利用します。"
              icon={<Camera size={19} />}
              checked={prefs.camera}
              onChange={() => setPrefs((p) => ({ ...p, camera: !p.camera }))}
            />
            <Setting
              label="雨と光のアニメーション"
              description="動きを少なくしたいときはオフに"
              icon={<Sparkles size={19} />}
              checked={prefs.motion}
              onChange={() => setPrefs((p) => ({ ...p, motion: !p.motion }))}
            />
          </div>
          <div className="save-settings">
            <h3>記憶のセーブ</h3>
            <p>
              会話ごとにこの端末へ自動保存。同じブラウザで再開できます。
              {config.cloud
                ? "「保存」でクラウドにも保管します。"
                : "クラウド保存は未設定です。"}
            </p>
            <div className="button-row">
              <button
                className="outline-button"
                disabled={!session}
                onClick={() => void save()}
              >
                <Check size={15} />
                保存
              </button>
              <button
                className="outline-button"
                disabled={!session}
                onClick={exportSave}
              >
                <Download size={15} />
                書き出す
              </button>
              <button
                className="outline-button"
                onClick={() => file.current?.click()}
              >
                <Upload size={15} />
                読み込む
              </button>
            </div>
            <p className="small-note">
              書き出したファイルも、元のブラウザのCookieが必要です。
            </p>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importSave(f);
                e.target.value = "";
              }}
            />
          </div>
          {config.accessCode && (
            <label className="access-code">
              プレイコード
              <input
                type="password"
                autoComplete="off"
                value={prefs.code}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, code: e.target.value }))
                }
              />
            </label>
          )}
          <button
            className="text-button restart"
            onClick={() => setModal("restart")}
          >
            <RotateCcw size={14} />
            新しい物語をはじめる
          </button>
        </Modal>
      )}

      {modal === "about" && (
        <Modal
          title="言葉で、心がほどけていく。"
          onClose={() => setModal(null)}
        >
          <p className="modal-description">
            LIVEは、記憶を失ったAIと会話をしながら、
            <br />
            彼女の過去と人格を取り戻していく物語です。
          </p>
          <div className="howto">
            <div>
              <span>01</span>
              <h3>まずは、話しかける。</h3>
              <p>
                声でも文字でも、あなたの言葉で。選択肢から話題を選んでも大丈夫です。
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>情景を、一緒にたどる。</h3>
              <p>
                何をしていたのか。誰といたのか。どう感じたのか。会話を重ねると記憶の断片がつながります。
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>ひとつの心に、出会う。</h3>
              <p>
                答えを当てることがゴールではありません。彼女が「私」を語れるまで、そばにいてください。
              </p>
            </div>
          </div>
          <p className="privacy-note">
            彼女の音声はAIが生成します。音声会話中の音声・会話文はOpenAIへ送信されます。カメラは任意で、映像は端末内で処理します。体験モードでは外部AIを呼ばず、用意した台詞とキーワード判定で遊べます。
          </p>
        </Modal>
      )}

      {modal === "restart" && (
        <Modal
          title={hasSave ? "もう一度、出会う。" : "物語の扉を開く。"}
          onClose={() => setModal(null)}
        >
          <p className="modal-description">
            {hasSave
              ? "新しい物語をはじめると、端末のつづきから再開するデータを更新します。今の記憶を残す場合は、設定から書き出してください。"
              : "あなたの言葉で、彼女の記憶をたどってください。"}
          </p>
          <div className="button-row">
            <button
              className="gold-button"
              disabled={busy}
              onClick={() => void start(config.ai ? "live" : "demo")}
            >
              新しくはじめる
              <ArrowRight size={17} />
            </button>
            {config.ai && (
              <button
                className="outline-button"
                disabled={busy}
                onClick={() => void start("demo")}
              >
                体験モード
              </button>
            )}
            <button className="text-button" onClick={() => setModal(null)}>
              戻る
            </button>
          </div>
        </Modal>
      )}

      {modal === "history" && (
        <Modal title="交わした言葉" onClose={() => setModal(null)}>
          <p className="modal-description">最近の会話を、そっと読み返す。</p>
          <div className="history-list">
            {state?.history.map((m, i) => (
              <article key={i} className={m.role}>
                <span>{m.role === "user" ? "あなた" : "彼女"}</span>
                <p>{m.content}</p>
              </article>
            ))}
          </div>
          <p className="small-note">
            最近16件の会話を表示します。音声会話の履歴は解析単位の要約です。
          </p>
        </Modal>
      )}

      {modal === "memory" && (
        <Modal
          title="記憶のかけら"
          onClose={() => {
            setModal(null);
            setSelected(null);
          }}
          wide
        >
          <p className="modal-description">
            話した言葉たちが、彼女の記憶を取り戻していく。
            <span className="board-count">
              MEMORY {count} / {memories.length}
            </span>
          </p>
          <div className="memory-board">
            <div className="board-root">
              ✧<span>彼女の物語</span>
            </div>
            <div className="memory-grid">
              {memories.map((m, i) => {
                const s = state?.memories.find((s) => s.id === m.id);
                return (
                  <button
                    key={m.id}
                    className={`memory-node node-${i} ${s?.unlocked ? "unlocked" : s?.stage ? "partial" : "lost"} ${selected === m.id ? "selected" : ""}`}
                    onClick={() => setSelected(m.id)}
                  >
                    <span className="node-index">0{i + 1}</span>
                    <div className="memory-thumb">
                      {s?.unlocked ? (
                        <img
                          src={m.image}
                          alt=""
                          style={{ objectPosition: m.position }}
                        />
                      ) : (
                        <Lock size={23} />
                      )}
                    </div>
                    <span className="node-title">
                      {s?.unlocked
                        ? m.title
                        : s?.stage
                          ? m.hints[0]
                          : "まだ、見えない記憶"}
                    </span>
                    <small>
                      {s?.unlocked
                        ? "RESTORED"
                        : s?.stage
                          ? "FRAGMENT"
                          : "UNKNOWN"}
                    </small>
                    {s?.unlocked && <Check className="node-check" size={13} />}
                  </button>
                );
              })}
            </div>
          </div>
          {detail && (
            <div className="memory-detail">
              {detailState?.unlocked ? (
                <>
                  <img
                    src={detail.image}
                    style={{ objectPosition: detail.position }}
                    alt={detail.title}
                  />
                  <div>
                    <span className="eyebrow">A PIECE OF HER LIFE</span>
                    <h3>{detail.title}</h3>
                    <p>{detail.narrative}</p>
                  </div>
                </>
              ) : (
                <div>
                  <h3>
                    {detailState?.stage
                      ? "かすかな輪郭"
                      : "まだ、眠っている記憶。"}
                  </h3>
                  <p>
                    {detailState?.stage
                      ? detail.hints[Math.min(2, detailState.stage - 1)]
                      : "会話のなかで、少しずつ見えてくるものがあります。焦らず、彼女の言葉に耳を傾けてください。"}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="board-footer">
            <span>出来事から、情景へ。情景から、心へ。</span>
            <button
              className="text-button"
              onClick={() => {
                setModal(null);
                setSelected(null);
              }}
            >
              物語に戻る <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}

      {unlock && (
        <Modal title="記憶の灯りが、ひとつ。" onClose={closeUnlock} wide>
          <div className="unlock-scene">
            <img src={unlock.image} alt={unlock.title} />
            <div>
              <p className="eyebrow">MEMORY FRAGMENT FOUND</p>
              <Ornament />
              <h2>{unlock.title}</h2>
              <p>{unlock.narrative}</p>
            </div>
          </div>
          <div className="unlock-bottom">
            <span>忘れていた毎日が、少しずつ戻ってくる。</span>
            <button className="gold-button" onClick={closeUnlock}>
              {state?.completed ? "彼女の言葉を聴く" : "物語をつづける"}
              <ArrowRight size={18} />
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
function Setting({
  label,
  description,
  icon,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="setting-row">
      {icon}
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`toggle ${checked ? "on" : ""}`}
      >
        <span />
      </button>
    </div>
  );
}
