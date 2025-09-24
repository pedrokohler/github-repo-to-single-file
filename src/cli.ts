import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { GitHubClient } from "./github.js";
import { ProgressPrinter } from "./progress.js";
import {
  describeOutput,
  exportRepositoryToSingleFile,
  loadRepositoryOutline,
} from "./exporter.js";
import { resolveGitHubToken } from "./env.js";
import {
  PREFETCH_REQUESTS,
  calculatePlannedRequestTotal,
  estimateDurationSeconds,
} from "./statistics.js";
import type { RateLimit } from "./types.js";
import { MAX_CONCURRENCY } from "./config.js";

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
  outline: Awaited<ReturnType<typeof loadRepositoryOutline>>
): void {
  console.log(`Repository: ${outline.coordinates.owner}/${outline.repoName}`);
  console.log(`Default branch: ${outline.branch}`);
  console.log(
    `Discovered ${outline.blobs.length} blobs (` +
      `${outline.eligibleBlobs.length} candidates, ` +
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
  plannedTotal: number,
  durationSeconds: number,
  rateLimit: RateLimit
): void {
  console.log(
    `Planned API requests: total=${plannedTotal} (prefetch=${PREFETCH_REQUESTS}, blob downloads=${eligibleCount}).`
  );
  console.log(
    `Estimated completion time: ${formatSeconds(
      durationSeconds
    )} with concurrency ${MAX_CONCURRENCY}.`
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

export async function runCli(): Promise<void> {
  const repoUrl = process.argv[2];
  if (!repoUrl) {
    console.error(
      "Usage: npm run fetch -- https://github.com/owner/repo (GITHUB_TOKEN sourced from .env)"
    );
    process.exitCode = 2;
    return;
  }

  const token = resolveGitHubToken();
  const client = new GitHubClient(token);

  console.log("Preparing repository outline...");
  const outline = await loadRepositoryOutline(client, repoUrl);
  const rateLimit = await client.getRateLimit();

  logOutlineDetails(outline);

  const eligibleCount = outline.eligibleBlobs.length;
  const plannedTotal = calculatePlannedRequestTotal(eligibleCount);
  const durationSeconds = estimateDurationSeconds(eligibleCount);

  logPlanningSummary(eligibleCount, plannedTotal, durationSeconds, rateLimit);
  warnAboutQuota(rateLimit, eligibleCount);

  const proceed = await promptForConfirmation("Proceed with download? [y/N]");
  if (!proceed) {
    console.log("Aborted by user.");
    return;
  }

  const progress = new ProgressPrinter();
  progress.start(eligibleCount);

  const result = await exportRepositoryToSingleFile(
    client,
    outline,
    (update) => {
      progress.update(update);
    }
  );

  progress.finish();
  console.log(describeOutput(result));
}
