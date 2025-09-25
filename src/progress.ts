import { PROGRESS_UPDATE_INTERVAL_MS } from "./config.js";

export type ProgressState = "included" | "skipped" | "cached";

export type ProgressUpdate = {
  processed: number;
  total: number;
  path: string;
  state: ProgressState;
};

export class ProgressPrinter {
  private total = 0;
  private processed = 0;
  private lastRenderTimestamp = 0;
  private lastUpdate: ProgressUpdate | null = null;
  private started = false;
  private label: string;

  constructor(
    private readonly stream: NodeJS.WriteStream = process.stdout,
    private readonly now: () => number = Date.now,
    label = "Processing"
  ) {
    this.label = label;
  }

  start(total: number, label = this.label): void {
    this.label = label;
    this.total = Math.max(total, 0);
    this.processed = 0;
    this.lastUpdate = null;
    this.started = true;

    if (!this.stream.isTTY) {
      this.stream.write(`${this.label} ${this.total} items...\n`);
    } else {
      this.render(true);
    }
  }

  update(update: ProgressUpdate): void {
    if (!this.started) return;
    this.processed = update.processed;
    this.lastUpdate = update;

    if (!this.stream.isTTY) {
      this.stream.write(
        `Processed ${update.processed}/${update.total}: ${update.path} (${update.state})\n`
      );
      return;
    }

    const now = this.now();
    if (
      update.processed < update.total &&
      now - this.lastRenderTimestamp < PROGRESS_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    this.render();
    this.lastRenderTimestamp = now;
  }

  finish(): void {
    if (!this.started) return;
    if (this.stream.isTTY) {
      this.render(true);
      this.stream.write("\n");
    }
    this.started = false;
  }

  setTotal(total: number): void {
    this.total = Math.max(total, this.processed);
    if (!this.started) return;
    if (this.stream.isTTY) {
      this.render(true);
    }
  }

  private render(force = false): void {
    const percent = this.total === 0 ? 100 : Math.floor((this.processed / this.total) * 100);
    const barLength = 24;
    const filledLength = this.total === 0 ? barLength : Math.round((percent / 100) * barLength);
    const bar = `${"#".repeat(filledLength)}${"-".repeat(barLength - filledLength)}`;
    const latestPath = this.lastUpdate?.path ?? "";
    const latestState = this.lastUpdate?.state ?? "pending";
    const summary = `${this.processed}/${this.total}`;
    const line = `${this.label} [${bar}] ${summary} (${percent}%) ${latestState}: ${latestPath}`;

    const width = this.stream.columns ?? line.length;
    const padded = line.padEnd(width);
    this.stream.write(`\r${force ? padded : padded}`);
  }
}
