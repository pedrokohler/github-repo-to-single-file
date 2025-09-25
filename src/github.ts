import { setTimeout as delay } from "node:timers/promises";
import {
  GH_API,
  MAX_RETRIES,
  RETRY_BASE_MS,
} from "./config.js";
import type {
  BlobResponse,
  GitTreeResponse,
  RateLimit,
  RepoResponse,
} from "./types.js";

function buildHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-repo-to-single-file",
    Authorization: `Bearer ${token}`,
  };
}

export class GitHubClient {
  private readonly headers: Record<string, string>;

  constructor(private readonly token: string) {
    this.headers = buildHeaders(token);
  }

  private async request<T>(path: string, attempt = 1): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${GH_API}${path}`, {
        headers: this.headers,
      });
    } catch (error) {
      if (attempt <= MAX_RETRIES) {
        await delay(RETRY_BASE_MS * attempt);
        return this.request<T>(path, attempt + 1);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Network error contacting GitHub after ${attempt} attempts: ${message}`);
    }

    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    const remaining = remainingHeader === null ? Number.NaN : Number(remainingHeader);
    if (response.status === 403 && !Number.isNaN(remaining) && remaining <= 0) {
      const resetRaw = response.headers.get("x-ratelimit-reset");
      const resetTime = resetRaw ? new Date(Number(resetRaw) * 1000).toISOString() : "unknown reset";
      throw new Error(
        `GitHub API rate limit exceeded. Please retry after ${resetTime}.`
      );
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (shouldRetry && attempt <= MAX_RETRIES) {
      await delay(RETRY_BASE_MS * attempt);
      return this.request<T>(path, attempt + 1);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async getRepository(owner: string, repo: string): Promise<RepoResponse> {
    return this.request<RepoResponse>(`/repos/${owner}/${repo}`);
  }

  async getTree(owner: string, repo: string, ref: string): Promise<GitTreeResponse> {
    return this.request<GitTreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    );
  }

  async getBlob(owner: string, repo: string, sha: string): Promise<BlobResponse> {
    return this.request<BlobResponse>(
      `/repos/${owner}/${repo}/git/blobs/${sha}`
    );
  }

  async getRateLimit(): Promise<RateLimit> {
    return this.request<RateLimit>("/rate_limit");
  }

  getToken(): string {
    return this.token;
  }
}
