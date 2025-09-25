import type { ProgressUpdate } from "../progress.js";

export type PdfProgressStage = "render" | "write";

export type PdfInitialTotals = {
  renderTotal: number;
  writeTotal?: number;
};

export type PdfStageReport = {
  stage: PdfProgressStage;
  processed: number;
  total: number;
};

type StageState = {
  processed: number;
  total: number;
};

const DEFAULT_STAGE_STATE: StageState = {
  processed: 0,
  total: 0,
};

export interface ProgressSink {
  start(total: number, label: string): void;
  update(update: ProgressUpdate): void;
  finish(): void;
}

export interface PdfProgressCallbacks {
  initialise(totals: PdfInitialTotals): void;
  report(event: PdfStageReport): void;
  complete(): void;
}

export class PdfProgressReporter implements PdfProgressCallbacks {
  private readonly stageState: Record<PdfProgressStage, StageState> = {
    render: { ...DEFAULT_STAGE_STATE },
    write: { ...DEFAULT_STAGE_STATE },
  };

  private currentStage: PdfProgressStage = "render";
  private started = false;

  constructor(private readonly sink: ProgressSink) {}

  initialise({ renderTotal, writeTotal = 0 }: PdfInitialTotals): void {
    const safeRenderTotal = Math.max(renderTotal, 0);
    const safeWriteTotal = Math.max(writeTotal, 0);

    this.stageState.render = { ...DEFAULT_STAGE_STATE, total: safeRenderTotal };
    this.stageState.write = { ...DEFAULT_STAGE_STATE, total: safeWriteTotal };
    this.currentStage = "render";
    this.started = true;

    const total = this.aggregateTotal();
    this.sink.start(total, "Generating PDF");
    this.publish();
  }

  report(event: PdfStageReport): void {
    if (!this.started) {
      this.initialise({ renderTotal: event.total, writeTotal: 0 });
    }

    this.updateStageState(event);
    this.currentStage = event.stage;
    this.publish();
  }

  complete(): void {
    if (!this.started) return;

    this.stageState.render.processed = this.stageState.render.total;
    this.stageState.write.processed = this.stageState.write.total;
    this.publish();
    this.sink.finish();
    this.started = false;
  }

  private updateStageState({ stage, processed, total }: PdfStageReport): void {
    const safeTotal = Math.max(total, 0);
    const boundedProcessed = Math.min(Math.max(processed, 0), safeTotal);

    this.stageState[stage] = {
      processed: boundedProcessed,
      total: safeTotal,
    };
  }

  private aggregateTotal(): number {
    const total =
      this.stageState.render.total + this.stageState.write.total;
    const processed =
      this.stageState.render.processed + this.stageState.write.processed;
    return Math.max(total, processed, 1);
  }

  private aggregateProcessed(): number {
    return (
      this.stageState.render.processed + this.stageState.write.processed
    );
  }

  private publish(): void {
    const total = this.aggregateTotal();
    const processed = this.aggregateProcessed();

    const update: ProgressUpdate = {
      processed,
      total,
      path: this.currentStage,
      state: "included",
      statusText:
        this.currentStage === "render" ? "rendering pages" : "writing to disk",
    };

    this.sink.update(update);
  }
}
