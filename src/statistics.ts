import {
  AVERAGE_REQUEST_LATENCY_MS,
  MAX_CONCURRENCY,
} from "./config.js";

export const PREFETCH_REQUESTS = 3; // repo, tree, rate-limit

export function calculatePlannedRequestTotal(
  blobCount: number,
  prefetchCount = PREFETCH_REQUESTS
): number {
  return prefetchCount + Math.max(blobCount, 0);
}

export function estimateDurationSeconds(
  blobCount: number,
  concurrency = MAX_CONCURRENCY,
  averageLatencyMs = AVERAGE_REQUEST_LATENCY_MS
): number {
  if (blobCount <= 0) return 0;
  const effectiveConcurrency = Math.max(1, concurrency);
  const batches = Math.ceil(blobCount / effectiveConcurrency);
  const estimatedMs = batches * Math.max(averageLatencyMs, 1);
  return Math.max(1, Math.ceil(estimatedMs / 1000));
}
