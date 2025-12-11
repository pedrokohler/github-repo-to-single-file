import { parseRepoUrl, isLocalPath } from "../src/repository.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseRepoUrl", () => {
  it("parses a standard GitHub URL", () => {
    const result = parseRepoUrl("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses a GitHub URL with .git suffix", () => {
    const result = parseRepoUrl("https://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses a GitHub URL with trailing slash", () => {
    const result = parseRepoUrl("https://github.com/owner/repo/");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("throws for non-GitHub URLs", () => {
    expect(() => parseRepoUrl("https://gitlab.com/owner/repo")).toThrow(
      "Repository must be hosted on github.com"
    );
  });

  it("throws for invalid URL formats", () => {
    expect(() => parseRepoUrl("https://github.com/owner")).toThrow(
      "Expected URL in the form https://github.com/owner/repo"
    );
  });

  it("throws for non-URL strings", () => {
    expect(() => parseRepoUrl("not-a-url")).toThrow("Invalid GitHub URL");
  });
});

describe("isLocalPath", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `repo-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns true for an existing directory", async () => {
    const result = await isLocalPath(testDir);
    expect(result).toBe(true);
  });

  it("returns false for a GitHub URL", async () => {
    const result = await isLocalPath("https://github.com/owner/repo");
    expect(result).toBe(false);
  });

  it("returns false for a non-existent path", async () => {
    const result = await isLocalPath("/path/that/does/not/exist");
    expect(result).toBe(false);
  });

  it("returns false for a file path", async () => {
    const filePath = join(testDir, "file.txt");
    await writeFile(filePath, "content");
    const result = await isLocalPath(filePath);
    expect(result).toBe(false);
  });
});

