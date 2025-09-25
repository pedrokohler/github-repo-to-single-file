import { Writable } from "node:stream";
import { parseRepoUrl } from "../src/exporter.js";
import {
  decodeBase64ToBytes,
  looksTexty,
  hasSkippedExtension,
} from "../src/text.js";
import { mapWithConcurrency } from "../src/concurrency.js";
import {
  calculatePlannedRequestTotal,
  estimateDurationSeconds,
  PREFETCH_REQUESTS,
} from "../src/statistics.js";
import { ProgressPrinter } from "../src/progress.js";

describe("parseRepoUrl", () => {
  it("parses owner and repository name", () => {
    expect(parseRepoUrl("https://github.com/octocat/Hello-World")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("strips trailing .git", () => {
    expect(parseRepoUrl("https://github.com/octocat/Hello-World.git")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("throws for malformed URLs", () => {
    expect(() => parseRepoUrl("not-a-url")).toThrow(/Invalid GitHub URL/);
  });
});

describe("text helpers", () => {
  it("recognises textual files by extension", () => {
    const bytes = new Uint8Array([65, 66, 67]);
    expect(looksTexty("file.ts", bytes)).toBe(true);
  });

  it("falls back to heuristic for binary data", () => {
    const bytes = new Uint8Array([0, 0, 255, 128]);
    expect(looksTexty("image.bin", bytes)).toBe(false);
  });

  it("skips known media extensions", () => {
    const bytes = new Uint8Array([65, 66, 67]);
    expect(looksTexty("cover.png", bytes)).toBe(false);
    expect(looksTexty("audio.mp3", bytes)).toBe(false);
    expect(looksTexty("scan.dcm", bytes)).toBe(false);
    expect(looksTexty("diagram.pdf", bytes)).toBe(false);
    expect(looksTexty("font.woff2", bytes)).toBe(false);
    expect(looksTexty("video.webm", bytes)).toBe(false);
    expect(looksTexty("bundle.jar", bytes)).toBe(false);
    expect(hasSkippedExtension("cover.png")).toBe(true);
    expect(hasSkippedExtension("scan.dcm")).toBe(true);
    expect(hasSkippedExtension("diagram.pdf")).toBe(true);
    expect(hasSkippedExtension("font.woff2")).toBe(true);
    expect(hasSkippedExtension("archive.iso")).toBe(true);
    expect(hasSkippedExtension("bin/app.exe")).toBe(true);
    expect(hasSkippedExtension("package-lock.json")).toBe(true);
    expect(hasSkippedExtension("nested/yarn.lock")).toBe(true);
    expect(hasSkippedExtension("archive.tar.gz")).toBe(true);
    expect(hasSkippedExtension("bundle.zip")).toBe(true);
  });

  it("removes newlines inserted by GitHub", () => {
    const encoded = Buffer.from("hello", "utf8").toString("base64");
    const withNewlines = `${encoded.slice(0, 4)}\n${encoded.slice(4)}`;
    expect(Buffer.from(decodeBase64ToBytes(withNewlines))).toEqual(
      Buffer.from("hello", "utf8")
    );
  });
});

describe("planning helpers", () => {
  it("includes prefetch requests in planned total", () => {
    expect(calculatePlannedRequestTotal(10)).toBe(PREFETCH_REQUESTS + 10);
  });

  it("returns zero duration for zero requests", () => {
    expect(estimateDurationSeconds(0)).toBe(0);
  });

  it("estimates duration proportionally to concurrency", () => {
    const highConcurrency = estimateDurationSeconds(16, 8, 100);
    const lowConcurrency = estimateDurationSeconds(16, 4, 100);
    expect(lowConcurrency).toBeGreaterThanOrEqual(highConcurrency);
  });
});

describe("progress printer", () => {
  class MemoryStream extends Writable {
    public readonly chunks: string[] = [];
    public readonly columns = 120;
    public readonly isTTY = true;

    _write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ): void {
      this.chunks.push(chunk.toString());
      callback();
    }
  }

  it("renders progress updates", () => {
    let time = 0;
    const stream = new MemoryStream();
    const printer = new ProgressPrinter(stream as unknown as NodeJS.WriteStream, () => {
      time += 1000;
      return time;
    });

    printer.start(2);
    printer.update({
      processed: 1,
      total: 2,
      path: "src/file-one.ts",
      state: "included",
    });
    printer.update({
      processed: 2,
      total: 2,
      path: "src/file-two.ts",
      state: "included",
    });
    printer.finish();

    expect(stream.chunks.some((chunk) => chunk.includes("2/2"))).toBe(true);
  });
});

describe("mapWithConcurrency", () => {
  it("resolves values with the provided concurrency", async () => {
    const calls: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      calls.push(value);
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
    expect(calls.length).toBe(4);
  });
});
