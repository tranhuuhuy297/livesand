// Frames-per-second over a sliding window of arrival times.
const WINDOW_MS = 1000;
const MAX_SAMPLES = 240;

export class FrameArrivalRateMeter {
  private readonly arrivals: number[] = [];

  record(now: number): void {
    this.arrivals.push(now);
    if (this.arrivals.length > MAX_SAMPLES) this.arrivals.shift();
  }

  fps(now: number): number {
    const a = this.arrivals;
    while (a.length > 0 && now - a[0] > WINDOW_MS) a.shift();
    if (a.length < 2) return 0;
    return ((a.length - 1) * 1000) / Math.max(1, a[a.length - 1] - a[0]);
  }
}
