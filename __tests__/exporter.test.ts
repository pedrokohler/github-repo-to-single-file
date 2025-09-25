import { loadRepositoryOutline } from "../src/exporter.js";
import type { GitHubClient } from "../src/github.js";
import type {
  GitTreeItem,
  GitTreeResponse,
  RepoResponse,
} from "../src/types.js";

const repoResponse: RepoResponse = {
  default_branch: "main",
  name: "sample-repo",
  owner: { login: "acme" },
};

const treeEntries: GitTreeItem[] = [
  {
    path: "README.md",
    mode: "100644",
    type: "blob",
    sha: "sha-readme",
    size: 120,
    url: "https://example.com/blob/readme",
  },
  {
    path: "src/index.ts",
    mode: "100644",
    type: "blob",
    sha: "sha-index",
    size: 240,
    url: "https://example.com/blob/index",
  },
];

function createTreeResponse(): GitTreeResponse {
  return {
    sha: "tree-sha",
    truncated: false,
    tree: treeEntries,
  };
}

function createClient(overrides: {
  getRepository?: jest.Mock;
  getTree?: jest.Mock;
} = {}): { client: GitHubClient; getRepository: jest.Mock; getTree: jest.Mock } {
  const getRepository =
    overrides.getRepository ?? jest.fn(async () => repoResponse);
  const getTree = overrides.getTree ?? jest.fn(async () => createTreeResponse());
  const client = {
    getRepository,
    getTree,
  } as unknown as GitHubClient;
  return { client, getRepository, getTree };
}

describe("loadRepositoryOutline", () => {
  const repoUrl = "https://github.com/acme/sample-repo";

  it("uses the repository's default branch when none is specified", async () => {
    const { client, getTree } = createClient();

    const outline = await loadRepositoryOutline(client, repoUrl);

    expect(getTree).toHaveBeenCalledWith("acme", "sample-repo", "main");
    expect(outline.branch).toBe("main");
    expect(outline.defaultBranch).toBe("main");
  });

  it("respects an explicit branch selection", async () => {
    const { client, getTree } = createClient();

    const outline = await loadRepositoryOutline(client, repoUrl, {
      branch: "feature/new-ui",
    });

    expect(getTree).toHaveBeenCalledWith(
      "acme",
      "sample-repo",
      "feature/new-ui"
    );
    expect(outline.branch).toBe("feature/new-ui");
    expect(outline.defaultBranch).toBe("main");
  });

  it("trims branch names and rejects empty selections", async () => {
    const { client } = createClient();

    await expect(
      loadRepositoryOutline(client, repoUrl, { branch: "  " })
    ).rejects.toThrow("Branch name cannot be empty");

    const outline = await loadRepositoryOutline(client, repoUrl, {
      branch: " feature/new-ui ",
    });
    expect(outline.branch).toBe("feature/new-ui");
  });

  it("wraps GitHub errors when the requested branch is unavailable", async () => {
    const failingTree = jest.fn(async () => {
      throw new Error("Not Found");
    });
    const { client } = createClient({ getTree: failingTree });

    await expect(
      loadRepositoryOutline(client, repoUrl, { branch: "missing" })
    ).rejects.toThrow(
      'Failed to load branch "missing" for acme/sample-repo: Not Found'
    );
  });
});

