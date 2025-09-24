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
  const tree = await client.getTree(coordinates.owner, coordinates.repo, branch);
  const blobs = tree.tree.filter((entry) => entry.type === "blob");
  const filteredByExtension = blobs.filter((blob) => !hasSkippedExtension(blob.path));
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
  const sorted = [...eligibleBlobs].sort((a, b) => a.path.localeCompare(b.path));
  let processed = 0;

  const outcomes = await mapWithConcurrency(sorted, MAX_CONCURRENCY, async (item) => {
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
      return { kind: "skipped" as const, path: item.path };
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
      return { kind: "skipped" as const, path: item.path };
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    processed += 1;
    options.onProgress?.({
      processed,
      total: sorted.length,
      path: item.path,
      state: "included",
    });

    return { kind: "included" as const, path: item.path, content: text };
  });

  const { files, skippedBinary } = outcomes.reduce(
    (acc, outcome) => {
      if (outcome.kind === "included") {
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

export async function exportRepositoryToSingleFile(
  client: GitHubClient,
  outline: RepositoryOutline,
  onProgress?: ProgressCallback
): Promise<ExportResult> {
  const { files, skippedBinary } = await collectTextFiles(client, outline, {
    onProgress,
  });

  const output = await prepareOutputFile(`${outline.repoName}-${outline.branch}.txt`);
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

  const summary: ExportSummary = {
    included: files.length,
    skippedBinary,
    skippedLarge: outline.skippedLarge,
    skippedExtension: outline.skippedExtension,
    total: outline.blobs.length,
    truncatedTree: outline.treeTruncated,
  };

  const footer = buildFooter(summary);
  await closeStream(output.stream, footer);
  if (streamError) throw streamError;

  return { output, summary };
}

export function describeOutput(result: ExportResult): string {
  const fileName = basename(result.output.fullPath);
  return (
    `Wrote ${fileName} (included ${result.summary.included} files, ` +
    `skipped ${result.summary.skippedBinary} likely-binary files, ` +
    `${result.summary.skippedExtension} extension-filtered files)`
  );
}
