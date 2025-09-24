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
    const response = await fetch(`${GH_API}${path}`, {
      headers: this.headers,
    });

    if (response.status === 403 && attempt <= MAX_RETRIES) {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const waitFor = Math.max(reset - Date.now(), RETRY_BASE_MS * attempt);
      await delay(waitFor);
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
