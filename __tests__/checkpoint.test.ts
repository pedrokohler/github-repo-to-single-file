import {
  readCachedFile,
  writeCachedFile,
  cleanupWorkDirectory,
  countCachedFiles,
} from "../src/checkpoint.js";

const outline = {
  coordinates: { owner: "test-owner" },
  repoName: "test-repo",
  branch: "feature/test",
};

describe("checkpoint storage", () => {
  afterEach(async () => {
    await cleanupWorkDirectory(outline);
  });

  it("returns null when a cached file is missing", async () => {
    expect(await readCachedFile(outline, "missing.txt")).toBeNull();
  });

  it("persists and retrieves cached content", async () => {
    await writeCachedFile(outline, "dir/file.txt", "cached content");
    await expect(readCachedFile(outline, "dir/file.txt")).resolves.toBe(
      "cached content"
    );
  });

  it("counts cached files within the outline", async () => {
    await writeCachedFile(outline, "a.txt", "A");
    await writeCachedFile(outline, "nested/b.txt", "B");
    const count = await countCachedFiles(outline, ["a.txt", "nested/b.txt", "missing.txt"]);
    expect(count).toBe(2);
  });
});
