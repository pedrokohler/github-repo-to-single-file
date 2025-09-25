import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { GitHubClient } from "./github.js";
import { ProgressPrinter } from "./progress.js";
import {
  describeOutput,
  exportRepositoryToSingleFile,
  loadRepositoryOutline,
  type OutputFormat,
} from "./exporter.js";
import { resolveGitHubToken } from "./env.js";
import {
  PREFETCH_REQUESTS,
  calculatePlannedRequestTotal,
  estimateDurationSeconds,
} from "./statistics.js";
import type { RateLimit } from "./types.js";
import { MAX_CONCURRENCY } from "./config.js";
import { countCachedFiles } from "./checkpoint.js";

export type CliOptions = {
  repoUrl: string;
  format: OutputFormat;
};

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "under a second";
  if (seconds === 1) return "about 1 second";
  if (seconds < 60) return `about ${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (rem === 0) return `about ${minutes} minute${minutes > 1 ? "s" : ""}`;
  return `about ${minutes} minute${minutes > 1 ? "s" : ""} ${rem} seconds`;
}

function formatRateLimit(limit: RateLimit): string {
  const core = limit.resources.core;
  return `current ${core.remaining}/${core.limit}`;
}

function formatRemainingLimit(limit: RateLimit, plannedTotal: number): string {
  const core = limit.resources.core;
  const resetIso = new Date(core.reset * 1000).toISOString();
  return `after ${core.remaining - plannedTotal}/${
    core.limit
  } (resets ${resetIso})`;
}

async function promptForConfirmation(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.warn(
      "Non-interactive terminal detected; proceeding without confirmation."
    );
    return true;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function logOutlineDetails(
  outline: Awaited<ReturnType<typeof loadRepositoryOutline>>,
  cachedEligible: number,
  pendingDownloads: number
): void {
  console.log(`Repository: ${outline.coordinates.owner}/${outline.repoName}`);
  console.log(`Default branch: ${outline.branch}`);
  console.log(
    `Discovered ${outline.blobs.length} blobs (` +
      `${outline.eligibleBlobs.length} candidates, ` +
      `${cachedEligible} cached, ` +
      `${pendingDownloads} to download, ` +
      `${outline.skippedLarge} skipped for size, ` +
      `${outline.skippedExtension} skipped by extension).`
  );
  if (outline.treeTruncated) {
    console.warn(
      "Warning: GitHub returned a truncated tree; some files might be missing."
    );
  }
}

function logPlanningSummary(
  eligibleCount: number,
  cachedEligible: number,
  pendingDownloads: number,
  plannedTotal: number,
  durationSeconds: number,
  rateLimit: RateLimit
): void {
  console.log(
    `Planned API requests: total=${plannedTotal} (prefetch=${PREFETCH_REQUESTS}, pending blob downloads=${pendingDownloads}, cached reused=${cachedEligible}).`
  );
  console.log(
    `Estimated download time: ${formatSeconds(
      durationSeconds
    )} with concurrency ${MAX_CONCURRENCY} for ${pendingDownloads} pending files.`
  );
  console.log(
    `GitHub core quota: ${formatRateLimit(rateLimit)}; ${formatRemainingLimit(
      rateLimit,
      plannedTotal
    )}`
  );
  // console.log(`Github core quota: `);
}

function willExceedQuota(rateLimit: RateLimit, required: number): boolean {
  return required > rateLimit.resources.core.remaining;
}

function warnAboutQuota(rateLimit: RateLimit, required: number): void {
  if (!willExceedQuota(rateLimit, required)) return;
  console.warn(
    `Warning: run requires ${required} additional requests,` +
      ` but only ${rateLimit.resources.core.remaining} remain in the quota.`
  );
}

export function parseArguments(argv: string[]): CliOptions {
  let format: OutputFormat = "text";
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--pdf") {
      format = "pdf";
      continue;
    }

    if (arg.startsWith("--format")) {
      const [flag, valueCandidate] = arg.includes("=")
        ? arg.split("=", 2)
        : [arg, argv[++i]];
      if (!valueCandidate) {
        throw new Error("Missing value for --format");
      }
      if (valueCandidate !== "text" && valueCandidate !== "pdf") {
        throw new Error(`Unsupported format: ${valueCandidate}`);
      }
      format = valueCandidate;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length === 0) {
    throw new Error(
      "Usage: npm run fetch -- [--pdf|--format=pdf] https://github.com/owner/repo"
    );
  }

  return {
    repoUrl: positional[0],
    format,
  };
}

export async function runCli(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const token = resolveGitHubToken();
  const client = new GitHubClient(token);

  console.log("Preparing repository outline...");
  const outline = await loadRepositoryOutline(client, options.repoUrl);
  const rateLimit = await client.getRateLimit();

  const cachedEligible = await countCachedFiles(
    outline,
    outline.eligibleBlobs.map((blob) => blob.path)
  );
  const pendingDownloads = Math.max(
    outline.eligibleBlobs.length - cachedEligible,
    0
  );

  logOutlineDetails(outline, cachedEligible, pendingDownloads);

  const eligibleCount = outline.eligibleBlobs.length;
  const plannedTotal = calculatePlannedRequestTotal(pendingDownloads);
  const durationSeconds = estimateDurationSeconds(pendingDownloads);

  logPlanningSummary(
    eligibleCount,
    cachedEligible,
    pendingDownloads,
    plannedTotal,
    durationSeconds,
    rateLimit
  );
  warnAboutQuota(rateLimit, pendingDownloads);

  const proceed = await promptForConfirmation("Proceed with download? [y/N]");
  if (!proceed) {
    console.log("Aborted by user.");
    return;
  }

  const progress = new ProgressPrinter();
  progress.start(eligibleCount, "Downloading");

  const pdfPrinter =
    options.format === "pdf"
      ? new ProgressPrinter(undefined, undefined, "Generating PDF")
      : null;

  const pdfCallbacks = pdfPrinter
    ? {
        start: (total: number) => pdfPrinter.start(total, "Generating PDF"),
        update: (processed: number, total: number) =>
          pdfPrinter.update({
            processed,
            total,
            path: "",
            state: "included",
          }),
        setTotal: (total: number) => pdfPrinter.setTotal(total),
        finish: () => pdfPrinter.finish(),
      }
    : undefined;

  const result = await exportRepositoryToSingleFile(client, outline, {
    onProgress: (update) => progress.update(update),
    format: options.format,
    pdfProgress: pdfCallbacks,
  });

  progress.finish();
  console.log(describeOutput(result));
}
