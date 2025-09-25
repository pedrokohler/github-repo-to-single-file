import { basename } from "node:path";
import { MAX_CONCURRENCY, MAX_TEXT_BLOB_BYTES } from "./config.js";
import { mapWithConcurrency } from "./concurrency.js";
import { GitHubClient } from "./github.js";
import {
  closeStream,
  prepareOutputFile,
  writeChunk,
  type OutputTarget,
} from "./io.js";
import {
  ensureTrailingNewline,
  headerFor,
  looksTexty,
  decodeBase64ToBytes,
  hasSkippedExtension,
} from "./text.js";
import type {
  ExportSummary,
  FileExport,
  GitTreeItem,
  RepoCoordinates,
} from "./types.js";
import type { ProgressState } from "./progress.js";
import { renderPdfFromText, estimatePdfPageCount } from "./pdf.js";
import {
  cleanupWorkDirectory,
  ensureWorkDirectory,
  readCachedFile,
  writeCachedFile,
} from "./checkpoint.js";
import { once } from "node:events";
import type {
  PdfProgressCallbacks,
  PdfProgressStage,
} from "./progress/pdfProgressReporter.js";

export type ProgressCallback = (args: {
  processed: number;
  total: number;
  path: string;
  state: ProgressState;
}) => void;

export type RepositoryOutline = {
  coordinates: RepoCoordinates;
  repoName: string;
  branch: string;
  blobs: GitTreeItem[];
  eligibleBlobs: GitTreeItem[];
  skippedLarge: number;
  skippedExtension: number;
  treeTruncated: boolean;
};

export type OutputFormat = "text" | "pdf";

export function parseRepoUrl(input: string): RepoCoordinates {
  try {
    const url = new URL(input);
    if (url.hostname !== "github.com") {
      throw new Error("Repository must be hosted on github.com");
    }

    const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (segments.length < 2) {
      throw new Error("Expected URL in the form https://github.com/owner/repo");
    }

    const [owner, rawRepo] = segments;
    const repo = rawRepo.replace(/\.git$/i, "");
    if (!owner || !repo) {
      throw new Error("Repository owner and name must both be present");
    }

    return { owner, repo };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid GitHub URL: ${message}`);
  }
}

export async function loadRepositoryOutline(
  client: GitHubClient,
  repoUrl: string
): Promise<RepositoryOutline> {
  const coordinates = parseRepoUrl(repoUrl);
  const repository = await client.getRepository(
    coordinates.owner,
    coordinates.repo
  );
  const branch = repository.default_branch;
  const tree = await client.getTree(
    coordinates.owner,
    coordinates.repo,
    branch
  );
  const blobs = tree.tree.filter((entry) => entry.type === "blob");
  const filteredByExtension = blobs.filter(
    (blob) => !hasSkippedExtension(blob.path)
  );
  const extensionSkipped = blobs.length - filteredByExtension.length;
  const eligibleBlobs = filteredByExtension.filter(
    (blob) => typeof blob.size !== "number" || blob.size <= MAX_TEXT_BLOB_BYTES
  );

  return {
    coordinates,
    repoName: repository.name,
    branch,
    blobs,
    eligibleBlobs,
    skippedLarge: filteredByExtension.length - eligibleBlobs.length,
    skippedExtension: extensionSkipped,
    treeTruncated: Boolean(tree.truncated),
  };
}

type CollectOptions = {
  onProgress?: ProgressCallback;
};

type CollectOutcome = {
  files: FileExport[];
  skippedBinary: number;
};

async function collectTextFiles(
  client: GitHubClient,
  outline: RepositoryOutline,
  options: CollectOptions = {}
): Promise<CollectOutcome> {
  const { eligibleBlobs } = outline;
  const sorted = [...eligibleBlobs].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  let processed = 0;

  type OutcomeItem =
    | { kind: "included"; path: string; content: string }
    | { kind: "cached"; path: string; content: string }
    | { kind: "skipped"; path: string };

  await ensureWorkDirectory(outline);

  const outcomes = await mapWithConcurrency(
    sorted,
    MAX_CONCURRENCY,
    async (item) => {
      const cachedContent = await readCachedFile(outline, item.path);
      if (cachedContent !== null) {
        processed += 1;
        options.onProgress?.({
          processed,
          total: sorted.length,
          path: item.path,
          state: "cached",
        });
        return {
          kind: "cached",
          path: item.path,
          content: cachedContent,
        } as OutcomeItem;
      }

      const blob = await client.getBlob(
        outline.coordinates.owner,
        outline.coordinates.repo,
        item.sha
      );

      if (blob.encoding !== "base64") {
        processed += 1;
        options.onProgress?.({
          processed,
          total: sorted.length,
          path: item.path,
          state: "skipped",
        });
        return { kind: "skipped", path: item.path } as OutcomeItem;
      }

      const bytes = decodeBase64ToBytes(blob.content);
      if (!looksTexty(item.path, bytes)) {
        processed += 1;
        options.onProgress?.({
          processed,
          total: sorted.length,
          path: item.path,
          state: "skipped",
        });
        return { kind: "skipped", path: item.path } as OutcomeItem;
      }

      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      await writeCachedFile(outline, item.path, text);
      processed += 1;
      options.onProgress?.({
        processed,
        total: sorted.length,
        path: item.path,
        state: "included",
      });

      return {
        kind: "included",
        path: item.path,
        content: text,
      } as OutcomeItem;
    }
  );

  const { files, skippedBinary } = outcomes.reduce(
    (acc, outcome) => {
      if (outcome.kind === "included" || outcome.kind === "cached") {
        acc.files.push({ path: outcome.path, content: outcome.content });
      } else {
        acc.skippedBinary += 1;
      }
      return acc;
    },
    { files: [] as FileExport[], skippedBinary: 0 }
  );

  return { files, skippedBinary };
}

function buildHeader(outline: RepositoryOutline): string {
  return (
    `# Repository: ${outline.coordinates.owner}/${outline.repoName}\n` +
    `# Default branch: ${outline.branch}\n` +
    `# Files included: text-like files up to ${Math.round(
      MAX_TEXT_BLOB_BYTES / 1024 / 1024
    )} MB each.\n` +
    (outline.treeTruncated
      ? "# Warning: tree listing truncated by GitHub.\n"
      : "") +
    "\n"
  );
}

function buildFooter(summary: ExportSummary): string {
  return (
    `\n\n# Summary: included=${summary.included}, ` +
    `skippedBinary=${summary.skippedBinary}, ` +
    `skippedLarge=${summary.skippedLarge}, ` +
    `skippedExtension=${summary.skippedExtension}, total=${summary.total}` +
    (summary.truncatedTree ? ", treeTruncated=true" : "") +
    "\n"
  );
}

export type ExportResult = {
  output: OutputTarget;
  summary: ExportSummary;
};

async function exportToText(
  output: OutputTarget,
  outline: RepositoryOutline,
  files: FileExport[],
  summary: ExportSummary
): Promise<void> {
  let streamError: Error | null = null;
  output.stream.once("error", (error) => {
    streamError = error instanceof Error ? error : new Error(String(error));
  });

  const header = buildHeader(outline);
  await writeChunk(output.stream, header);
  if (streamError) throw streamError;

  for (const file of files) {
    await writeChunk(output.stream, headerFor(file.path));
    await writeChunk(output.stream, ensureTrailingNewline(file.content));
    if (streamError) throw streamError;
  }

  const footer = buildFooter(summary);
  await closeStream(output.stream, footer);
  if (streamError) throw streamError;
}

async function exportToPdf(
  output: OutputTarget,
  outline: RepositoryOutline,
  files: FileExport[],
  summary: ExportSummary,
  pdfProgress?: PdfProgressCallbacks
): Promise<void> {
  const pieces: string[] = [];
  pieces.push(buildHeader(outline));
  for (const file of files) {
    pieces.push(headerFor(file.path));
    pieces.push(ensureTrailingNewline(file.content));
  }
  pieces.push(buildFooter(summary));

  const combined = pieces.join("");
  const estimatedPages = Math.max(estimatePdfPageCount(combined), 1);

  // Calculate total progress units: pages + write chunks
  const CHUNK_SIZE = 64 * 1024;
  const estimatedSize = combined.length * 1.5; // Rough PDF size estimate
  const estimatedChunks = Math.max(Math.ceil(estimatedSize / CHUNK_SIZE), 1);
  const RENDER_STAGE: PdfProgressStage = "render";
  const WRITE_STAGE: PdfProgressStage = "write";

  pdfProgress?.initialise({
    renderTotal: estimatedPages,
    writeTotal: estimatedChunks,
  });

  const renderResult = await renderPdfFromText(combined, {
    onProgress: ({ processed, total }) => {
      pdfProgress?.report({
        stage: RENDER_STAGE,
        processed,
        total,
      });
    },
  });

  const { buffer: pdfBuffer, pageCount } = renderResult;

  pdfProgress?.report({
    stage: RENDER_STAGE,
    processed: pageCount,
    total: pageCount,
  });

  // Update with actual chunks count
  const actualChunks = Math.max(Math.ceil(pdfBuffer.length / CHUNK_SIZE), 1);
  pdfProgress?.report({
    stage: WRITE_STAGE,
    processed: 0,
    total: actualChunks,
  });

  // Write to disk with progress updates
  let chunksWritten = 0;
  for (let offset = 0; offset < pdfBuffer.length; offset += CHUNK_SIZE) {
    const chunk = pdfBuffer.subarray(
      offset,
      Math.min(offset + CHUNK_SIZE, pdfBuffer.length)
    );
    if (!output.stream.write(chunk)) {
      await once(output.stream, "drain");
    }
    chunksWritten += 1;
    pdfProgress?.report({
      stage: WRITE_STAGE,
      processed: chunksWritten,
      total: actualChunks,
    });

    // Yield occasionally to keep UI responsive
    if (chunksWritten % 10 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  await new Promise<void>((resolve, reject) => {
    output.stream.once("finish", resolve);
    output.stream.once("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    output.stream.end();
  });

  pdfProgress?.complete();
}

type ExportOptions = {
  onProgress?: ProgressCallback;
  format?: OutputFormat;
  pdfProgress?: PdfProgressCallbacks;
};

export async function exportRepositoryToSingleFile(
  client: GitHubClient,
  outline: RepositoryOutline,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const { format = "text", onProgress, pdfProgress } = options;

  let finishedSuccessfully = false;
  try {
    const { files, skippedBinary } = await collectTextFiles(client, outline, {
      onProgress,
    });

    const summary: ExportSummary = {
      included: files.length,
      skippedBinary,
      skippedLarge: outline.skippedLarge,
      skippedExtension: outline.skippedExtension,
      total: outline.blobs.length,
      truncatedTree: outline.treeTruncated,
    };

    const extension = format === "pdf" ? "pdf" : "txt";
    const output = await prepareOutputFile(
      `${outline.repoName}-${outline.branch}.${extension}`
    );

    if (format === "pdf") {
      await exportToPdf(output, outline, files, summary, pdfProgress);
    } else {
      await exportToText(output, outline, files, summary);
    }

    finishedSuccessfully = true;
    return { output, summary };
  } finally {
    if (finishedSuccessfully) {
      await cleanupWorkDirectory(outline);
    }
  }
}

export function describeOutput(result: ExportResult): string {
  const fileName = basename(result.output.fullPath);
  return (
    `Wrote ${fileName} (included ${result.summary.included} files, ` +
    `skipped ${result.summary.skippedBinary} likely-binary files, ` +
    `${result.summary.skippedExtension} extension-filtered files)`
  );
}
