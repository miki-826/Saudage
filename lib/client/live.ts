export type LiveStatus = "idle" | "connecting" | "live" | "reconnecting";
export type MicReason = "unsupported" | "denied" | "missing";
export type LiveHandlers = {
  onReady: () => void;
  onInput: (text: string) => void;
  onOutput: (text: string) => void;
  onSpeaking: (speaking: boolean) => void;
  onStatus: (status: LiveStatus) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onClosed: () => void;
};
export type MicCheck =
  | { ok: true }
  | { ok: false; reason: MicReason; message: string };

/** Microphone availability, checked without opening a stream where possible. */
export async function checkMicrophone(): Promise<MicCheck> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof RTCPeerConnection === "undefined"
  )
    return {
      ok: false,
      reason: "unsupported",
      message:
        "このブラウザは音声会話に対応していません。選択肢とテキストで物語を進められます。",
    };
  try {
    const status = await navigator.permissions?.query({
      name: "microphone" as PermissionName,
    });
    if (status?.state === "denied")
      return {
        ok: false,
        reason: "denied",
        message:
          "マイクの使用がブロックされています。選択肢とテキストで物語を進められます。",
      };
  } catch {
    /* Safari has no microphone permission descriptor; fall through. */
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Before permission is granted labels are empty, so only an empty audio
    // input list is conclusive evidence that no microphone exists.
    if (devices.length && !devices.some((d) => d.kind === "audioinput"))
      return {
        ok: false,
        reason: "missing",
        message:
          "マイクが見つかりませんでした。選択肢とテキストで物語を進められます。",
      };
  } catch {
    /* Enumeration is best effort. */
  }
  return { ok: true };
}

export function micErrorMessage(error: unknown): {
  reason: MicReason;
  message: string;
} {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return {
      reason: "denied",
      message:
        "マイクの使用が許可されませんでした。選択肢とテキストでそのまま続けられます。",
    };
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return {
      reason: "missing",
      message:
        "マイクが見つかりませんでした。選択肢とテキストでそのまま続けられます。",
    };
  return {
    reason: "unsupported",
    message:
      error instanceof Error && error.message
        ? error.message
        : "音声に接続できませんでした。選択肢とテキストでそのまま続けられます。",
  };
}

// Silence after which collected speech is treated as a finished turn.
const TURN_SILENCE_MS = 1100;
// Even during a long monologue, hand a turn to the memory engine this often.
const TURN_MAX_MS = 7000;
// A gap this long between spoken transcript deltas starts a fresh caption.
const CAPTION_GAP_MS = 1400;
// Give up reconnecting after this many transparent re-dials.
const MAX_ATTEMPTS = 2;

export class LiveConnection {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private input = "";
  private output = "";
  private lastOutputEnd = 0;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private maxTurn: ReturnType<typeof setTimeout> | null = null;
  private speakingTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private ready = false;
  private muted = false;
  private disposed = false;
  private attempts = 0;
  private token = "";
  private code = "";
  private pending: string | null = null;
  constructor(private handlers: LiveHandlers) {}

  get connected() {
    return this.ready;
  }

  async start(token: string, code: string) {
    this.token = token;
    this.code = code;
    this.attempts = 0;
    await this.connect();
  }

  /** Refresh the signed state used for the next re-dial. */
  setToken(token: string) {
    this.token = token;
  }

  private async connect() {
    this.closed = false;
    this.ready = false;
    this.input = "";
    this.output = "";
    this.lastOutputEnd = 0;
    this.handlers.onStatus(this.attempts ? "reconnecting" : "connecting");
    try {
      const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.peer = peer;
      const audio = this.audio ?? new Audio();
      this.audio = audio;
      audio.autoplay = true;
      audio.muted = false;
      peer.ontrack = (e) => {
        audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        void audio.play().catch(() =>
          this.handlers.onNotice(
            "ブラウザが自動再生を止めました。画面を一度タップすると彼女の声が聞こえます。",
          ),
        );
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.disposed || this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.mic = stream;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !this.muted;
        peer.addTrack(t, stream);
      });
      // The quickstart requires the data channel and its listeners to exist
      // before the offer is generated.
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onmessage = (e) => {
        try {
          this.event(JSON.parse(e.data));
        } catch {
          /* One unparsable frame must not end the conversation. */
        }
      };
      channel.onclose = () => this.drop("connection_lost");
      peer.onconnectionstatechange = () => {
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "disconnected"
        )
          this.drop("connection_lost");
      };
      await peer.setLocalDescription(await peer.createOffer());
      await this.gathered(peer);
      if (this.disposed || this.closed) return;
      const response = await fetch("/api/live", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-game-code": this.code,
        },
        body: JSON.stringify({
          token: this.token,
          sdp: peer.localDescription?.sdp,
        }),
        signal: AbortSignal.timeout(55000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (this.disposed || this.closed) return;
      await peer.setRemoteDescription({
        type: "answer",
        sdp: data.transport.sdp,
      });
      // session.start must not be sent on the data channel: the HTTP request
      // above already opened the session.
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /** Resolve once ICE settles, and also on timeout: a partial SDP still connects. */
  private gathered(peer: RTCPeerConnection) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const timer = setTimeout(finish, 3000);
      peer.addEventListener("icegatheringstatechange", check);
      // Guards the race where gathering completed before the listener attached.
      check();
    });
  }

  private event(e: {
    type: string;
    delta?: string;
    start_ms?: number;
    end_ms?: number;
    reason?: string;
    error?: { message?: string; code?: string | null };
    context_window?: { usage_ratio?: number };
  }) {
    switch (e.type) {
      case "session.started": {
        this.ready = true;
        this.attempts = 0;
        this.handlers.onStatus("live");
        this.handlers.onReady();
        // Context queued while the call was still connecting is applied now.
        if (this.pending) {
          this.send({
            type: "session.update",
            session: {
              delegation: { responses: { instructions: this.pending } },
            },
          });
          this.pending = null;
        }
        this.append(
          "session.commentary.append",
          "相手がいま、はじめてあなたに話しかけました。短く一言だけ日本語で声をかけて、そのあとは相手の言葉を待ってください。",
        );
        break;
      }
      case "session.input_transcript.delta": {
        if (!e.delta) break;
        // The previous build dropped deltas whose approximate end_ms had not
        // advanced, which silently swallowed most of what the player said.
        this.input += e.delta;
        if (this.silence) clearTimeout(this.silence);
        this.silence = setTimeout(() => this.flush(), TURN_SILENCE_MS);
        if (!this.maxTurn)
          this.maxTurn = setTimeout(() => this.flush(), TURN_MAX_MS);
        break;
      }
      case "session.output_transcript.delta": {
        if (!e.delta) break;
        const start = e.start_ms ?? 0;
        // A gap means a new spoken turn, so the caption restarts instead of
        // growing into a run-on blob of every reply so far.
        if (start && start - this.lastOutputEnd > CAPTION_GAP_MS)
          this.output = "";
        this.lastOutputEnd = e.end_ms ?? start;
        this.output = (this.output + e.delta).slice(-700);
        this.handlers.onOutput(this.output);
        this.handlers.onSpeaking(true);
        if (this.speakingTimer) clearTimeout(this.speakingTimer);
        this.speakingTimer = setTimeout(
          () => this.handlers.onSpeaking(false),
          900,
        );
        break;
      }
      case "session.usage.updated": {
        // Re-dial before the context window fills, which would otherwise end
        // the call in the middle of a sentence.
        if ((e.context_window?.usage_ratio ?? 0) > 0.85)
          this.renew("会話が長くなったので、そっと接続をつなぎ直しました。");
        break;
      }
      case "session.closed": {
        this.drop(e.reason ?? "close_requested");
        break;
      }
      case "error": {
        const message = e.error?.message ?? "";
        console.error("live error", e.error);
        if (e.error?.code === "session_expired" || /expired/i.test(message))
          this.renew("音声セッションを更新しました。そのまま続けられます。");
        else if (!this.ready)
          this.handlers.onError(message || "音声処理でエラーが発生しました。");
        // A rejected append while the call is healthy is recoverable, so it
        // must not tear down a working conversation.
        break;
      }
    }
  }

  private flush() {
    if (this.silence) clearTimeout(this.silence);
    if (this.maxTurn) clearTimeout(this.maxTurn);
    this.silence = null;
    this.maxTurn = null;
    const text = this.input.trim();
    this.input = "";
    // The caption is deliberately left alone here: clearing it is what made
    // her replies disappear mid-sentence.
    if (text) this.handlers.onInput(text.slice(0, 1500));
  }

  private send(event: Record<string, unknown>) {
    if (this.ready && this.channel?.readyState === "open") {
      this.channel.send(
        JSON.stringify({ ...event, event_id: crypto.randomUUID() }),
      );
      return true;
    }
    return false;
  }

  /** Context appends cap at 500 tokens, so long text is split across events. */
  private append(type: string, content: string) {
    for (const part of content.match(/[\s\S]{1,900}/g) ?? [])
      this.send({ type, delegation_id: null, content: part });
  }

  /**
   * Replace the backend prompt instead of appending to it. Repeated appends
   * grew the context until she started echoing the same lines back.
   */
  update(context: string, unlock: string | null) {
    if (!this.ready) {
      this.pending = context;
      return;
    }
    this.send({
      type: "session.update",
      session: { delegation: { responses: { instructions: context } } },
    });
    if (unlock)
      this.append(
        "session.commentary.append",
        "たったいま記憶がひとつ戻りました: " +
          unlock.slice(0, 400) +
          " これをあなた自身の言葉で、驚きをこめて短く話してください。同じ文をそのまま読み上げないこと。",
      );
  }

  hint(text: string) {
    this.append(
      "session.commentary.append",
      "会話が止まっています。次の手がかりを、あなた自身の言い方で短くつぶやいてください: " +
        text.slice(0, 300),
    );
  }

  /** Let her react to something the player typed while the call is open. */
  typed(text: string) {
    this.append(
      "session.commentary.append",
      "相手が文字でこう伝えました: 「" +
        text.slice(0, 300) +
        "」 これに声で短く応えてください。",
    );
  }

  pauseForMemory() {
    if (this.audio) this.audio.muted = true;
    this.mic?.getAudioTracks().forEach((t) => {
      t.enabled = false;
    });
    this.send({ type: "session.input_audio.mute" });
  }
  resumeAfterMemory() {
    if (this.audio) this.audio.muted = false;
    this.mic?.getAudioTracks().forEach((t) => {
      t.enabled = !this.muted;
    });
    if (!this.muted) this.send({ type: "session.input_audio.unmute" });
  }
  /** Player-controlled mute, independent of the memory-scene pause. */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.mic?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    this.send({
      type: muted ? "session.input_audio.mute" : "session.input_audio.unmute",
    });
  }

  private drop(reason: string) {
    if (this.closed || this.disposed) return;
    if (
      this.attempts < MAX_ATTEMPTS &&
      (reason === "expired" || reason === "connection_lost")
    ) {
      this.renew(
        reason === "expired"
          ? "音声セッションを更新しました。そのまま続けられます。"
          : "通信が途切れたので、つなぎ直しています。",
      );
      return;
    }
    if (reason === "content")
      this.handlers.onError(
        "内容の制限により音声が終了しました。テキストで続けられます。",
      );
    else if (reason === "connection_lost" || reason === "expired")
      this.handlers.onError(
        "音声接続が切れました。もう一度「声で話す」を押すか、テキストで続けられます。",
      );
    this.cleanup();
  }

  /** Transparent re-dial: the player keeps talking, the call is replaced. */
  private renew(notice: string) {
    if (this.disposed || this.attempts >= MAX_ATTEMPTS) {
      this.cleanup();
      return;
    }
    this.attempts++;
    this.handlers.onNotice(notice);
    this.teardown();
    this.closed = false;
    void this.connect().catch(() => {
      this.handlers.onError(
        "音声を再接続できませんでした。もう一度「声で話す」を押してください。",
      );
      this.cleanup();
    });
  }

  stop() {
    this.disposed = true;
    this.send({ type: "session.close" });
    this.cleanup();
  }
  dispose() {
    this.stop();
  }

  private teardown() {
    this.ready = false;
    if (this.silence) clearTimeout(this.silence);
    if (this.maxTurn) clearTimeout(this.maxTurn);
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.silence = this.maxTurn = this.speakingTimer = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.onclose = null;
      this.channel.close();
      this.channel = null;
    }
    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
      this.peer = null;
    }
  }

  private cleanup() {
    if (this.closed) return;
    this.closed = true;
    this.teardown();
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
    this.handlers.onSpeaking(false);
    this.handlers.onStatus("idle");
    this.handlers.onClosed();
  }
}
