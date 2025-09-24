import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { OUT_DIR } from "./config.js";

export type OutputTarget = {
  stream: WriteStream;
  fullPath: string;
  fileName: string;
};

async function ensureWritableFile(path: string): Promise<void> {
  try {
    const stats = await stat(path);
    if (stats.isFile()) {
      await rm(path);
    }
  } catch {
    // File does not exist, nothing to remove.
  }
}

export async function prepareOutputFile(fileBaseName: string): Promise<OutputTarget> {
  await mkdir(OUT_DIR, { recursive: true });
  const outputPath = join(OUT_DIR, fileBaseName);
  await ensureWritableFile(outputPath);
  const stream = createWriteStream(outputPath, { encoding: "utf8" });

  return {
    stream,
    fullPath: outputPath,
    fileName: basename(outputPath),
  };
}

export async function writeChunk(stream: WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk, "utf8")) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const handleDrain = () => {
      stream.off("error", handleError);
      resolve();
    };
    const handleError = (error: unknown) => {
      stream.off("drain", handleDrain);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    stream.once("drain", handleDrain);
    stream.once("error", handleError);
  });
}

export async function closeStream(stream: WriteStream, tail: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.end(tail, "utf8", resolve);
  });
}
