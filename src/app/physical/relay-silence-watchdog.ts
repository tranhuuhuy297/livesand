// Browsers never surface WebSocket pings, so a relay that stops talking is how a silently dead link shows up.

// The relay sends status every 5 s; this much silence means the link died without a FIN (e.g. a Wi-Fi drop).
export const RELAY_SILENCE_TIMEOUT_MS = 15_000;

export class RelaySilenceWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastHeardAt = 0;

  constructor(private readonly onSilent: () => void, private readonly timeoutMs = RELAY_SILENCE_TIMEOUT_MS) {}

  start(): void {
    this.stop();
    this.lastHeardAt = performance.now();
    this.timer = setInterval(() => {
      if (performance.now() - this.lastHeardAt < this.timeoutMs) return;
      this.stop();
      this.onSilent();
    }, this.timeoutMs / 5);
  }

  /** Any message from the relay proves the link is alive. */
  heard(): void {
    this.lastHeardAt = performance.now();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
