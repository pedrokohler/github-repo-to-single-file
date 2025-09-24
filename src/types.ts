export type GitTreeItem = {
  path: string;
  mode: string;
  type: "blob" | "tree" | string;
  sha: string;
  size?: number;
  url: string;
};

export type GitTreeResponse = {
  sha: string;
  tree: GitTreeItem[];
  truncated: boolean;
};

export type RepoResponse = {
  default_branch: string;
  name: string;
  owner: { login: string };
};

export type BlobResponse = {
  content: string;
  encoding: "base64";
  size: number;
};

export type RepoCoordinates = { owner: string; repo: string };

export type FileExport = { path: string; content: string };

export type ExportSummary = {
  included: number;
  skippedBinary: number;
  skippedLarge: number;
  skippedExtension: number;
  total: number;
  truncatedTree: boolean;
};

export type RateLimit = {
  resources: {
    core: {
      limit: number;
      remaining: number;
      reset: number;
      used: number;
    };
  };
  rate: {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
  };
};
