import { loadRepositoryOutline } from "../src/exporter.js";
import type { IRepositoryClient, RepositoryInfo } from "../src/repository.js";
import type {
  GitTreeItem,
} from "../src/types.js";

const repoInfo: RepositoryInfo = {
  defaultBranch: "main",
  name: "sample-repo",
  coordinates: { owner: "acme", repo: "sample-repo" },
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

function createTreeResponse() {
  return {
    tree: treeEntries,
    truncated: false,
  };
}

function createClient(overrides: {
  getInfo?: jest.Mock;
  getTree?: jest.Mock;
} = {}): { client: IRepositoryClient; getInfo: jest.Mock; getTree: jest.Mock } {
  const getInfo =
    overrides.getInfo ?? jest.fn(async () => repoInfo);
  const getTree = overrides.getTree ?? jest.fn(async () => createTreeResponse());
  const getBlob = jest.fn();
  const getSource = jest.fn(() => "github" as const);
  const client = {
    getInfo,
    getTree,
    getBlob,
    getSource,
  } as unknown as IRepositoryClient;
  return { client, getInfo, getTree };
}

describe("loadRepositoryOutline", () => {
  it("uses the repository's default branch when none is specified", async () => {
    const { client, getTree } = createClient();

    const outline = await loadRepositoryOutline(client);

    expect(getTree).toHaveBeenCalledWith("main");
    expect(outline.branch).toBe("main");
    expect(outline.defaultBranch).toBe("main");
  });

  it("respects an explicit branch selection", async () => {
    const { client, getTree } = createClient();

    const outline = await loadRepositoryOutline(client, {
      branch: "feature/new-ui",
    });

    expect(getTree).toHaveBeenCalledWith("feature/new-ui");
    expect(outline.branch).toBe("feature/new-ui");
    expect(outline.defaultBranch).toBe("main");
  });

  it("trims branch names and rejects empty selections", async () => {
    const { client } = createClient();

    await expect(
      loadRepositoryOutline(client, { branch: "  " })
    ).rejects.toThrow("Branch name cannot be empty");

    const outline = await loadRepositoryOutline(client, {
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
      loadRepositoryOutline(client, { branch: "missing" })
    ).rejects.toThrow(
      'Failed to load branch "missing" for acme/sample-repo: Not Found'
    );
  });
});

