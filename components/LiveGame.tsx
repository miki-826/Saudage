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
  HelpCircle,
  Keyboard,
  Ear,
  LogOut,
} from "lucide-react";
import {
  memories,
  conversationHint,
  suggestionsFor,
  tone,
  type GameState,
  type VisualSignals,
  type Memory,
} from "@/lib/game/engine";
import story from "@/story/story.json";
import { Modal } from "./Modal";
import { CameraTracker } from "./CameraTracker";
import {
  LiveConnection,
  checkMicrophone,
  micErrorMessage,
  type LiveStatus,
  type MicReason,
} from "@/lib/client/live";

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
  sound: true,
  volume: 0.28,
  camera: false,
  motion: true,
  code: "",
};
const saveKey = "live-save-v1";
const guideKey = "live-guide-v1";
// Shown in full before the first conversation starts, so nothing about the
// controls has to be discovered by trial and error.
const GUIDE = [
  {
    heading: "これは、思い出させる物語です。",
    lead: "彼女は記憶を失ったAIです。名前も、昨日も、自分が何をしていたのかも覚えていません。",
    points: [
      "コンビニや接客などに近い意味の話題でも、AIが内容を読み取って記憶を開きます。順番は自由です。",
      "あなたが「どこにいたのか」「何をしていたのか」「誰と関わっていたのか」「どう感じていたのか」を語ると、彼女の中の記憶が刺激されます。",
      "5つの記憶がそろい、彼女が自分の言葉で「私はこういう存在だった」と語れたら、物語は終わります。",
    ],
  },
  {
    heading: "基本は、声で話しかけます。",
    lead: "物語を始めると自動でマイクにつながり、彼女と声でそのまま会話できます。",
    points: [
      "ブラウザがマイクの許可を聞いてきたら「許可」を選んでください。",
      "普通に話しかけてください。話し終えて少し黙ると、その言葉が彼女に届きます。",
      "彼女が話している途中でも、かぶせて話して大丈夫です。声の波形が動いている間は、彼女が話しています。",
      "「音声を終了」でいつでも切れます。もう一度「声で話す」で、すぐつなぎ直せます。",
      "通信が切れたり、会話が長くなったときは、自動で静かにつなぎ直します。",
    ],
  },
  {
    heading: "マイクが使えないときは、文字で。",
    lead: "マイクがない、許可できない、静かな場所にいる。そんなときも、同じ物語をそのまま進められます。",
    points: [
      "マイクが使えないと分かった時点で、選択肢とテキスト入力が自動で開きます。",
      "3つの選択肢は、いま話しかけると効きやすい話題です。会話が進むと中身が入れ替わります。",
      "自由入力では、情景や気持ちを自分の言葉で書くほど、記憶は深く動きます。",
      "音声中でも「文字で送る」からいつでも書けます。書いた言葉には、彼女が声で応えます。",
    ],
  },
  {
    heading: "記憶は、少しずつ灯ります。",
    lead: "ひとつの記憶には、何度かの手がかりが必要です。一度の発言では戻りません。",
    points: [
      "同じ言葉を繰り返しても進みません。言い方を変えて、別の角度から話してください。",
      "抽象的な単語より、音・光・手の感触・そのときの気持ちのような具体が効きます。",
      "しばらく進展がないと、彼女が短い手がかりをつぶやきます。記憶はあなたの会話の内容に応じて開きます。",
      "記憶が戻ると演出が入り、「記憶のかけら」に絵と物語が追加されます。",
    ],
  },
  {
    heading: "画面と、保存のこと。",
    lead: "覚えておくのは5つだけです。",
    points: [
      "右上「記憶のかけら」= 集めた記憶の一覧。左の肖像 = 彼女の心の段階。",
      "画面下の「会話の記録」= 交わした言葉の振り返り。",
      "会話するたびに、この端末へ自動保存されます。記憶を残す場合は設定から書き出せます。",
      "設定から、BGM・音量・カメラ補助・アニメーションの調整、セーブの書き出しと読み込みができます。",
      "カメラは完全に任意です。映像は端末内だけで処理し、送信しません。音声会話中の声と会話文はOpenAIへ送られます。",
    ],
  },
];
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

export function LiveGame() {
  const [config, setConfig] = useState<Config>({
    ai: false,
    cloud: false,
    accessCode: false,
  });
  const [session, setSession] = useState<Session | null>(null),
    [screen, setScreen] = useState<"home" | "game" | "ending">("home");
  const [modal, setModal] = useState<
      "settings" | "memory" | "about" | "restart" | "history" | "guide" | null
    >(null),
    [selected, setSelected] = useState<string | null>(null);
  const [guideStep, setGuideStep] = useState(0),
    [guideSeen, setGuideSeen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(defaults),
    [hasSave, setHasSave] = useState(false),
    [busy, setBusy] = useState(false),
    [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [line, setLine] = useState(story.opening),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [unlock, setUnlock] = useState<Memory | null>(null);
  const [voice, setVoice] = useState<LiveStatus>("idle"),
    [speaking, setSpeaking] = useState(false),
    [cameraReady, setCameraReady] = useState(false),
    [hintLevel, setHintLevel] = useState(0);
  // Voice is the default way to play; the typed panel appears when a
  // microphone is unavailable, or whenever the player asks for it.
  const [mic, setMic] = useState<{ reason: MicReason; message: string } | null>(
    null,
  );
  const [showText, setShowText] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null),
    live = useRef<LiveConnection | null>(null),
    current = useRef<Session | null>(null),
    prefsRef = useRef(prefs);
  const playEpoch = useRef(0);
  const locked = useRef(false),
    spoken = useRef(""),
    contextRef = useRef(""),
    signals = useRef<VisualSignals | null>(null),
    conversationSeconds = useRef(0),
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
    live.current = null;
    setVoice("idle");
    setSpeaking(false);
  }
  function exitGame() {
    playEpoch.current++;
    queue.current = [];
    live.current?.dispose();
    stopVoice();
    setPrefs((p) => ({ ...p, camera: false }));
    conversationSeconds.current = 0;
    setUnlock(null);
    setModal(null);
    setScreen("home");
    setInput("");
    setError("");
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
            sound: stored.soundVersion === 2 ? stored.sound !== false : true,
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
        setGuideSeen(localStorage.getItem(guideKey) === "1");
        const token = localStorage.getItem(saveKey);
        setHasSave(!!token);
      } catch {
        /* An unavailable browser store does not prevent a new game. */
      }
      setHydrated(true);
    });
    return () => {
      active = false;
      live.current?.dispose();
    };
  }, []);
  useEffect(() => {
    const el = audio.current;
    if (el) {
      el.volume = prefs.volume;
      if (prefs.sound) {
        void el.play().catch(() => {});
      } else el.pause();
    }
    if (hydrated)
      try {
        localStorage.setItem(
          "live-preferences",
          JSON.stringify({
            ...prefs,
            soundVersion: 2,
            code: "",
            camera: false,
          }),
        );
      } catch {}
  }, [prefs, hydrated]);
  useEffect(() => {
    const play = () => {
      if (prefsRef.current.sound) void audio.current?.play().catch(() => {});
    };
    window.addEventListener("pointerdown", play);
    window.addEventListener("keydown", play);
    return () => {
      window.removeEventListener("pointerdown", play);
      window.removeEventListener("keydown", play);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (screen !== "game" || unlock || modal) return;
    const interval = setInterval(() => {
      const s = current.current;
      if (
        !s ||
        s.state.completed ||
        document.hidden ||
        (voice !== "live" && s.state.turn === 0)
      )
        return;
      conversationSeconds.current++;
      if (
        conversationSeconds.current >= 30 &&
        !locked.current &&
        !speaking &&
        hintCount.current < 3
      ) {
        const hint = conversationHint(s.state, hintCount.current);
        if (!hint) return;
        setLine(hint);
        live.current?.hint(hint);
        hintCount.current++;
        setHintLevel(hintCount.current);
        conversationSeconds.current = 0;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, unlock, modal, voice, speaking]);
  useEffect(() => {
    // Hiding the tab only mutes the microphone. Tearing the call down here is
    // what made the conversation die whenever the player glanced away.
    const hide = () => {
      live.current?.setMuted(document.hidden);
      if (document.hidden) setPrefs((p) => ({ ...p, camera: false }));
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  async function start() {
    if (locked.current) return;
    if (!config.ai) {
      setError("会話を始めるにはOpenAI APIの設定が必要です。");
      return;
    }
    playEpoch.current++;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      stopVoice();
      const data = await api<Session>("/api/session", {
        action: "new",
        mode: "live",
      });
      persist(data);
      conversationSeconds.current = 0;
      setLine(story.opening);
      setScreen("game");
      setHintLevel(0);
      hintCount.current = 0;
      contextRef.current = "";
      spoken.current = "";
      // First-time players read the full guide before anything starts; the
      // last page is what opens the microphone.
      if (!guideSeen) {
        setGuideStep(0);
        setModal("guide");
      } else {
        setModal(null);
        await connectVoice(data);
      }
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
    const epoch = playEpoch.current;
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
          // What she actually said, so history holds her real words.
          spoken: isVoice ? spoken.current.slice(-1400) : undefined,
          signals: signals.current,
        },
        prefsRef.current.code,
      );
      if (epoch !== playEpoch.current) return;
      persist(result);
      contextRef.current = result.context;
      live.current?.setToken(result.token);
      if (!isVoice || result.unlocked || result.state.completed)
        setLine(result.reply);
      // Typed input during a live call is spoken back, so the two ways of
      // talking to her stay one conversation.
      if (!isVoice && live.current?.connected && !result.unlocked)
        live.current.typed(text);
      setInput("");
      if (result.gain) {
        conversationSeconds.current = 0;
        hintCount.current = 0;
        setHintLevel(0);
      }
      if (result.warning) setNotice(result.warning);
      live.current?.update(
        result.context,
        result.unlocked ? result.reply : null,
      );
      if (result.unlocked) {
        conversationSeconds.current = 0;
        setModal(null);
        setUnlock(memories.find((m) => m.id === result.unlocked)!);
        live.current?.pauseForMemory();
        if (prefsRef.current.sound) chime();
      } else if (result.state.completed) {
        stopVoice();
        setScreen("ending");
      }
    } catch (e) {
      if (epoch !== playEpoch.current) return;
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
  /** Open the voice call. Falls back to the typed panel when the mic is out. */
  async function connectVoice(session: Session) {
    const epoch = playEpoch.current;
    const check = await checkMicrophone();
    if (epoch !== playEpoch.current) return;
    if (!check.ok) {
      // The inline notice beside the typed panel says this already.
      setMic({ reason: check.reason, message: check.message });
      setShowText(true);
      return;
    }
    // Tear the old call down first: its close handler resets the status, which
    // would otherwise land after this one and show "idle" while connecting.
    live.current?.stop();
    live.current = null;
    setVoice("connecting");
    setError("");
    const connection = new LiveConnection({
      onReady: () => {
        if (epoch !== playEpoch.current) {
          connection.dispose();
          return;
        }
        setMic(null);
        // A re-dialled call starts from the session config, so any context
        // learned since then is re-applied here.
        if (contextRef.current) connection.update(contextRef.current, null);
      },
      onInput: (t) => {
        if (epoch !== playEpoch.current) return;
        void processRef.current(t, true);
      },
      onOutput: (t) => {
        if (epoch !== playEpoch.current) return;
        spoken.current = t;
        setLine(t);
      },
      onSpeaking: setSpeaking,
      onStatus: setVoice,
      onNotice: setNotice,
      onError: setError,
      onClosed: () => {
        setVoice("idle");
        setSpeaking(false);
      },
    });
    live.current = connection;
    try {
      await connection.start(session.token, prefsRef.current.code);
      if (epoch !== playEpoch.current) connection.dispose();
    } catch (e) {
      if (epoch !== playEpoch.current) return;
      const { reason, message } = micErrorMessage(e);
      live.current = null;
      setVoice("idle");
      if (
        e instanceof Error &&
        /NotAllowedError|NotFoundError|SecurityError|OverconstrainedError/.test(
          e.name,
        )
      ) {
        setMic({ reason, message });
      } else setError((e as Error).message || message);
      setShowText(true);
    }
  }
  async function toggleVoice() {
    if (voice !== "idle") {
      stopVoice();
      setShowText(true);
      return;
    }
    if (!session) return;
    await connectVoice(session);
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
      if (contextRef.current) live.current?.update(contextRef.current, null);
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
  function finishGuide() {
    setGuideSeen(true);
    try {
      localStorage.setItem(guideKey, "1");
    } catch {
      /* A blocked store only means the guide shows again next time. */
    }
    setModal(null);
    const s = current.current;
    if (s && !s.state.completed) void connectVoice(s);
  }
  const state = session?.state,
    count = state?.memories.filter((m) => m.unlocked).length ?? 0,
    prompts = state ? suggestionsFor(state) : memories[0].suggestions;
  const voiceLive = voice === "live",
    voiceBusy = voice === "connecting" || voice === "reconnecting";
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
      <audio
        ref={audio}
        src="/sounds/streetlight.mp4"
        autoPlay
        loop
        preload="auto"
      />
      <header className="site-header">
        <button
          className="wordmark"
          aria-label="LIVE ホーム"
          onClick={exitGame}
        >
          LIVE<span>忘れた心に、灯りを。</span>
        </button>
        <nav aria-label="メインナビゲーション">
          <button
            className={screen === "home" ? "active" : ""}
            onClick={exitGame}
          >
            ホーム
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
            aria-label="遊び方の説明"
            onClick={() => {
              setGuideStep(0);
              setModal("guide");
            }}
          >
            <HelpCircle size={19} />
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
              </p>
              <button
                className="start-button"
                disabled={busy}
                onClick={() => (hasSave ? setModal("restart") : void start())}
              >
                <span className="button-star">✧</span>
                <span>
                  {busy ? "物語を開いています…" : "物語をはじめる"}
                  <small>BEGIN YOUR STORY</small>
                </span>
                <ArrowRight size={21} />
              </button>
              <button
                className="story-intro-button"
                onClick={() => setModal("about")}
              >
                <BookOpen size={18} /> 画像で見る、物語と遊び方{" "}
                <ChevronRight size={16} />
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
          </section>
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
              AI会話
              {voiceLive
                ? " · 音声接続中"
                : voiceBusy
                  ? " · 接続中"
                  : state.mode === "live"
                    ? " · テキスト"
                    : ""}
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
                  {voiceBusy
                    ? voice === "reconnecting"
                      ? "音声をつなぎ直しています"
                      : "音声をつないでいます"
                    : speaking
                      ? "彼女が話しています"
                      : busy
                        ? "記憶をたどっています"
                        : voiceLive
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
                {state.mode === "live" && (
                  <div className="voice-primary">
                    <button
                      className={`mic-button ${voiceLive ? "listening" : ""} ${speaking ? "hearing" : ""}`}
                      onClick={() => void toggleVoice()}
                      disabled={voiceBusy}
                    >
                      {voiceLive ? <MicOff size={19} /> : <Mic size={19} />}
                      <span>
                        {voice === "connecting"
                          ? "マイクにつないでいます…"
                          : voice === "reconnecting"
                            ? "つなぎ直しています…"
                            : voiceLive
                              ? "音声会話を終了"
                              : mic
                                ? "もう一度マイクを試す"
                                : "声で話しかける"}
                        <small>
                          {voiceLive
                            ? speaking
                              ? "彼女が話しています"
                              : "そのまま話しかけてください"
                            : mic
                              ? "いまは文字で進められます"
                              : "基本はこちら。話し終えると届きます"}
                        </small>
                      </span>
                      {voiceLive && (
                        <span className="wave-bars">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <i key={i} />
                          ))}
                        </span>
                      )}
                    </button>
                    <div className="voice-side">
                      <button
                        className={`camera-button ${showText ? "enabled" : ""}`}
                        onClick={() => setShowText((v) => !v)}
                        aria-expanded={showText || !voiceLive}
                      >
                        <Keyboard size={17} />
                        <span>
                          {showText || !voiceLive ? "文字を隠す" : "文字で送る"}
                        </span>
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
                        <Camera size={17} />
                        <span>
                          {prefs.camera
                            ? cameraReady
                              ? "補助中"
                              : "準備中"
                            : "カメラ任意"}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
                {mic && (
                  <p className="mic-fallback" role="status">
                    <Ear size={15} />
                    <span>
                      {mic.message}
                      {mic.reason === "denied" &&
                        " ブラウザのアドレスバーのマイク設定から許可すると、声で話せます。"}
                    </span>
                  </p>
                )}
                {(showText || !voiceLive) && (
                  <div className="text-panel">
                    <div className="reply-label">
                      <Feather size={14} />
                      <span>言葉を、届ける</span>
                      <span className="hairline" />
                    </div>
                    <div className="suggestions">
                      {prompts.map((text, i) => (
                        <button
                          key={text}
                          disabled={busy}
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
                        disabled={busy}
                        maxLength={1500}
                        aria-label="彼女に届けるメッセージ"
                        placeholder="あなたの言葉で、話しかけてみて…"
                      />
                      <button
                        disabled={busy || !input.trim()}
                        aria-label="メッセージを送信"
                      >
                        <Send size={19} />
                      </button>
                    </form>
                  </div>
                )}
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

      {screen !== "home" && !modal && !unlock && (
        <button className="exit-game-button" onClick={exitGame}>
          <LogOut size={21} /> 会話を終了して抜ける
        </button>
      )}

      {modal === "guide" && (
        <Modal
          title="はじめに、遊び方を全部。"
          onClose={() => (guideSeen ? setModal(null) : finishGuide())}
          wide
        >
          <div className="guide">
            <img
              className="guide-illustration"
              src={
                guideStep === 0
                  ? "/images/character.webp"
                  : guideStep === 3
                    ? "/images/memory-store.webp"
                    : "/images/street.webp"
              }
              alt={
                guideStep === 0
                  ? "記憶を失った彼女"
                  : guideStep === 3
                    ? "会話から浮かぶお店の記憶"
                    : "物語の舞台となる雨の街"
              }
            />
            <div className="guide-steps" aria-hidden="true">
              {GUIDE.map((g, i) => (
                <i key={g.heading} className={i <= guideStep ? "lit" : ""} />
              ))}
            </div>
            <span className="eyebrow">
              STEP {guideStep + 1} / {GUIDE.length}
            </span>
            <h3>{GUIDE[guideStep].heading}</h3>
            <p className="guide-lead">{GUIDE[guideStep].lead}</p>
            <ul className="guide-list">
              {GUIDE[guideStep].points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <div className="guide-nav">
              <button
                className="text-button"
                disabled={guideStep === 0}
                onClick={() => setGuideStep((n) => Math.max(0, n - 1))}
              >
                もどる
              </button>
              {guideStep < GUIDE.length - 1 ? (
                <>
                  <button className="text-button" onClick={finishGuide}>
                    説明を飛ばす
                  </button>
                  <button
                    className="gold-button"
                    onClick={() => setGuideStep((n) => n + 1)}
                  >
                    つぎへ <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <button className="gold-button" onClick={finishGuide}>
                  わかりました。彼女に会う
                  <ArrowRight size={17} />
                </button>
              )}
            </div>
            <p className="small-note">
              この説明は、画面右上の「?」からいつでも読み直せます。
            </p>
          </div>
        </Modal>
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
              会話ごとにこの端末へ自動保存。設定から書き出して保管できます。
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
          wide
        >
          <p className="modal-description">
            LIVEは、記憶を失ったAIと会話をしながら、
            <br />
            彼女の過去と人格を取り戻していく物語です。
          </p>
          <div className="story-picture-steps">
            <article>
              <img
                src="/images/character.webp"
                alt="街灯の下で記憶を探す彼女"
              />
              <div>
                <span className="eyebrow">01 · 出会う</span>
                <h3>記憶をなくした彼女に、言葉を。</h3>
                <p>
                  名前も昨日も思い出せない彼女。声で話しかけても、文字で伝えても大丈夫です。
                </p>
              </div>
            </article>
            <article>
              <img
                src="/images/memory-store.webp"
                alt="言葉から浮かび上がる、夜のお店の風景"
              />
              <div>
                <span className="eyebrow">02 · 思い出す</span>
                <h3>近い意味の言葉が、記憶を灯す。</h3>
                <p>
                  たとえば「お店」や「夜中も買い物できる場所」。AIが意味を読み取り、つながる記憶を開きます。話す順番は自由です。
                </p>
              </div>
            </article>
            <article>
              <img src="/images/street.webp" alt="灯りがともる街へ続く道" />
              <div>
                <span className="eyebrow">03 · つながる</span>
                <h3>5つのかけらが、ひとつの物語に。</h3>
                <p>
                  すべての記憶がそろうと、彼女が自分の過去を語ります。迷ったら、そっとこぼれるヒントを手がかりに。
                </p>
              </div>
            </article>
          </div>
          <button
            className="outline-button"
            onClick={() => {
              setGuideStep(0);
              setModal("guide");
            }}
          >
            <HelpCircle size={15} />
            操作説明をはじめから読む
          </button>
          <p className="privacy-note">
            彼女の音声はAIが生成します。音声会話中の音声・会話文はOpenAIへ送信されます。カメラは任意で、映像は端末内で処理します。
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
              ? "新しい物語をはじめると、端末の保存データを更新します。今の記憶を残す場合は、設定から書き出してください。"
              : "あなたの言葉で、彼女の記憶をたどってください。"}
          </p>
          <div className="button-row">
            <button
              className="gold-button"
              disabled={busy}
              onClick={() => void start()}
            >
              新しくはじめる
              <ArrowRight size={17} />
            </button>
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
