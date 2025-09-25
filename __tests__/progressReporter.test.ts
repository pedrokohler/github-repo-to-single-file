import type { ProgressUpdate } from "../src/progress.js";
import {
  PdfProgressReporter,
  type PdfStageReport,
} from "../src/progress/pdfProgressReporter.js";

type MockSink = {
  start: jest.Mock<void, [number, string]>;
  update: jest.Mock<void, [ProgressUpdate]>;
  finish: jest.Mock;
};

function createMockSink(): MockSink {
  return {
    start: jest.fn(),
    update: jest.fn(),
    finish: jest.fn(),
  };
}

describe("PdfProgressReporter", () => {
  it("aggregates render and write stages with descriptive status text", () => {
    const sink = createMockSink();
    const reporter = new PdfProgressReporter(sink);
    const updates: ProgressUpdate[] = [];
    sink.update.mockImplementation((update) => {
      updates.push({ ...update });
    });

    reporter.initialise({ renderTotal: 10, writeTotal: 5 });

    const renderEvent: PdfStageReport = {
      stage: "render",
      processed: 4,
      total: 10,
    };
    reporter.report(renderEvent);

    const writeStart: PdfStageReport = {
      stage: "write",
      processed: 0,
      total: 6,
    };
    reporter.report(writeStart);

    const writeProgress: PdfStageReport = {
      stage: "write",
      processed: 3,
      total: 6,
    };
    reporter.report(writeProgress);

    reporter.complete();

    expect(sink.start).toHaveBeenCalledWith(15, "Generating PDF");
    expect(updates).toHaveLength(5);
    expect(updates[0]).toMatchObject({
      processed: 0,
      total: 15,
      statusText: "rendering pages",
    });
    expect(updates[1]).toMatchObject({
      processed: 4,
      total: 15,
      statusText: "rendering pages",
    });
    expect(updates[2]).toMatchObject({
      processed: 4,
      total: 16,
      statusText: "writing to disk",
    });
    expect(updates[3]).toMatchObject({
      processed: 7,
      total: 16,
      statusText: "writing to disk",
    });
    expect(updates[4]).toMatchObject({ processed: 16, total: 16 });
    expect(sink.finish).toHaveBeenCalledTimes(1);
  });
});

