export type LiveHandlers = {
  onReady: () => void;
  onInput: (text: string) => void;
  onOutput: (text: string) => void;
  onError: (message: string) => void;
  onClosed: () => void;
};
export class LiveConnection {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private input = "";
  private output = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastInputEnd = -1;
  private closed = false;
  private ready = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lifetime: ReturnType<typeof setTimeout> | null = null;
  constructor(private handlers: LiveHandlers) {}
  async start(token: string, code: string) {
    try {
      this.closed = false;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      this.audio = new Audio();
      this.audio.autoplay = true;
      peer.ontrack = (e) => {
        if (this.audio) {
          this.audio.srcObject = new MediaStream([e.track]);
          void this.audio
            .play()
            .catch(() =>
              this.handlers.onError(
                "音声の再生がブロックされました。音声を終了し、もう一度開始してください。",
              ),
            );
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.mic = stream;
      stream.getAudioTracks().forEach((t) => peer.addTrack(t, stream));
      this.channel = peer.createDataChannel("oai-events");
      this.channel.onmessage = (e) => {
        try {
          this.event(JSON.parse(e.data));
        } catch {
          this.handlers.onError("音声イベントを読み込めませんでした。");
        }
      };
      this.channel.onclose = () => {
        if (!this.closed) this.cleanup();
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          this.handlers.onError(
            "音声接続が切れました。テキストで続けられます。",
          );
          this.cleanup();
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("接続準備がタイムアウトしました。")),
            10000,
          );
          peer.addEventListener("icegatheringstatechange", () => {
            if (peer.iceGatheringState === "complete") {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      if (this.closed) return;
      const response = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-game-code": code },
        body: JSON.stringify({ token, sdp: peer.localDescription?.sdp }),
        signal: AbortSignal.timeout(55000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (this.closed) return;
      await peer.setRemoteDescription({
        type: "answer",
        sdp: data.transport.sdp,
      });
      this.lifetime = setTimeout(
        () => {
          this.handlers.onError(
            "音声会話を15分で一度終了しました。もう一度接続して続けられます。",
          );
          this.stop();
        },
        15 * 60 * 1000,
      );
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  private event(e: {
    type: string;
    delta?: string;
    end_ms?: number;
    delegation_id?: string;
    delegation?: { id: string };
  }) {
    if (e.type === "session.started") {
      this.ready = true;
      this.handlers.onReady();
      this.send({
        type: "session.instructions.append",
        delegation_id: null,
        content:
          "今すぐ短く日本語で、ここにいてくれる相手に声をかけてください。そのあと聞いてください。",
      });
    }
    if (e.type === "session.input_transcript.delta" && e.delta) {
      if ((e.end_ms ?? 0) <= this.lastInputEnd) return;
      this.lastInputEnd = e.end_ms ?? this.lastInputEnd;
      this.input += e.delta;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 1800);
    }
    if (e.type === "session.output_transcript.delta" && e.delta) {
      this.output = (this.output + e.delta).slice(-600);
      this.handlers.onOutput(this.output);
    }
    if (e.type === "session.closed") this.cleanup();
    if (e.type === "session.delegation.created" && e.delegation?.id)
      this.send({
        type: "session.thinking.append",
        delegation_id: e.delegation.id,
        content:
          "外部操作はありません。記憶の判定はアプリが別途行います。現在許された記憶だけで、相手の話を聞いてください。",
      });
    if (e.type === "error")
      this.handlers.onError(
        "音声処理でエラーが発生しました。必要なら再接続してください。",
      );
  }
  private flush() {
    if (this.input.trim()) {
      this.handlers.onInput(this.input.trim().slice(0, 1500));
      this.input = "";
      this.output = "";
    }
  }
  private send(event: Record<string, unknown>) {
    if (this.ready && this.channel?.readyState === "open")
      this.channel.send(
        JSON.stringify({ ...event, event_id: crypto.randomUUID() }),
      );
  }
  update(context: string, unlock: string | null) {
    for (const content of context.match(/[\s\S]{1,280}/g) ?? [])
      this.send({
        type: "session.instructions.append",
        delegation_id: null,
        content,
      });
    if (unlock)
      this.send({
        type: "session.commentary.append",
        delegation_id: null,
        content: unlock.slice(0, 280),
      });
  }
  pauseForMemory() {
    if (this.audio) this.audio.muted = true;
    this.mic?.getTracks().forEach((t) => {
      t.enabled = false;
    });
    this.send({ type: "session.input_audio.mute" });
  }
  resumeAfterMemory() {
    if (this.audio) this.audio.muted = false;
    this.mic?.getTracks().forEach((t) => {
      t.enabled = true;
    });
    this.send({ type: "session.input_audio.unmute" });
  }
  hint(text: string) {
    this.send({
      type: "session.commentary.append",
      delegation_id: null,
      content: text,
    });
  }
  stop() {
    if (this.ready) {
      this.send({ type: "session.close" });
      this.mic?.getTracks().forEach((t) => {
        t.enabled = false;
      });
      this.closeTimer = setTimeout(() => this.cleanup(), 4000);
    } else this.cleanup();
  }
  dispose() {
    this.send({ type: "session.close" });
    this.cleanup();
  }
  private cleanup() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.lifetime) clearTimeout(this.lifetime);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.channel?.close();
    this.peer?.close();
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.handlers.onClosed();
  }
}
