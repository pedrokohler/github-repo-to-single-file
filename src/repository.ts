import { resolve as resolvePath, basename } from "node:path";
import { stat } from "node:fs/promises";
import type { BlobResponse, GitTreeItem, RepoCoordinates } from "./types.js";
import { GitHubClient } from "./github.js";
import { LocalFileSystemClient } from "./local.js";

export type RepositorySource = "github" | "local";

export type RepositoryInfo = {
  name: string;
  defaultBranch: string;
  coordinates?: RepoCoordinates;
  localPath?: string;
};

export interface IRepositoryClient {
  getInfo(): Promise<RepositoryInfo>;
  getTree(branch?: string): Promise<{ tree: GitTreeItem[]; truncated: boolean }>;
  getBlob(sha: string, owner?: string, repo?: string): Promise<BlobResponse>;
  getSource(): RepositorySource;
}

export class GitHubRepositoryClient implements IRepositoryClient {
  constructor(
    private readonly client: GitHubClient,
    private readonly coordinates: RepoCoordinates
  ) {}

  async getInfo(): Promise<RepositoryInfo> {
    const repository = await this.client.getRepository(
      this.coordinates.owner,
      this.coordinates.repo
    );
    return {
      name: repository.name,
      defaultBranch: repository.default_branch,
      coordinates: this.coordinates,
    };
  }

  async getTree(branch?: string): Promise<{ tree: GitTreeItem[]; truncated: boolean }> {
    const info = await this.getInfo();
    const effectiveBranch = branch || info.defaultBranch;
    const tree = await this.client.getTree(
      this.coordinates.owner,
      this.coordinates.repo,
      effectiveBranch
    );
    return { tree: tree.tree, truncated: tree.truncated };
  }

  async getBlob(sha: string): Promise<BlobResponse> {
    return this.client.getBlob(
      this.coordinates.owner,
      this.coordinates.repo,
      sha
    );
  }

  getSource(): RepositorySource {
    return "github";
  }

  async getRateLimit() {
    return this.client.getRateLimit();
  }
}

export class LocalRepositoryClient implements IRepositoryClient {
  private readonly client: LocalFileSystemClient;

  constructor(localPath: string) {
    const absolutePath = resolvePath(localPath);
    this.client = new LocalFileSystemClient(absolutePath);
  }

  async getInfo(): Promise<RepositoryInfo> {
    return {
      name: this.client.getRepositoryName(),
      defaultBranch: "local",
      localPath: this.client.getRootPath(),
    };
  }

  async getTree(branch?: string): Promise<{ tree: GitTreeItem[]; truncated: boolean }> {
    return this.client.getTree();
  }

  async getBlob(sha: string): Promise<BlobResponse> {
    return this.client.getBlob(sha);
  }

  getSource(): RepositorySource {
    return "local";
  }
}

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

export async function isLocalPath(input: string): Promise<boolean> {
  // Try to detect if input is a local path
  // If it doesn't look like a URL and points to an existing directory, treat as local
  try {
    // If it starts with http/https, it's definitely a URL
    if (input.startsWith("http://") || input.startsWith("https://")) {
      return false;
    }

    // Try to stat the path
    const absolutePath = resolvePath(input);
    const stats = await stat(absolutePath);
    return stats.isDirectory();
  } catch {
    // Path doesn't exist or can't be accessed
    return false;
  }
}

export async function createRepositoryClient(
  input: string,
  githubToken?: string
): Promise<IRepositoryClient> {
  const isLocal = await isLocalPath(input);

  if (isLocal) {
    return new LocalRepositoryClient(input);
  }

  // It's a GitHub URL
  if (!githubToken) {
    throw new Error("GitHub token is required for GitHub repositories");
  }
  const coordinates = parseRepoUrl(input);
  const client = new GitHubClient(githubToken);
  return new GitHubRepositoryClient(client, coordinates);
}

