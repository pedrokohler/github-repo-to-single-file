import { LocalFileSystemClient } from "../src/local.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("LocalFileSystemClient", () => {
  let testDir: string;
  let client: LocalFileSystemClient;

  beforeEach(async () => {
    testDir = join(tmpdir(), `local-client-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    client = new LocalFileSystemClient(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("getTree", () => {
    it("returns an empty tree for an empty directory", async () => {
      const result = await client.getTree();
      expect(result.tree).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it("discovers files in the root directory", async () => {
      await writeFile(join(testDir, "file1.txt"), "content1");
      await writeFile(join(testDir, "file2.js"), "content2");

      const result = await client.getTree();
      
      expect(result.tree).toHaveLength(2);
      expect(result.tree.map(item => item.path).sort()).toEqual([
        "file1.txt",
        "file2.js",
      ]);
      expect(result.truncated).toBe(false);
    });

    it("discovers files in nested directories", async () => {
      const subDir = join(testDir, "src");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(testDir, "README.md"), "readme");
      await writeFile(join(subDir, "index.ts"), "code");

      const result = await client.getTree();
      
      expect(result.tree).toHaveLength(2);
      expect(result.tree.map(item => item.path).sort()).toEqual([
        "README.md",
        join("src", "index.ts"),
      ]);
    });

    it("skips hidden files and directories", async () => {
      await writeFile(join(testDir, ".hidden"), "hidden");
      await writeFile(join(testDir, "visible.txt"), "visible");
      
      const hiddenDir = join(testDir, ".git");
      await mkdir(hiddenDir, { recursive: true });
      await writeFile(join(hiddenDir, "config"), "config");

      const result = await client.getTree();
      
      expect(result.tree).toHaveLength(1);
      expect(result.tree[0].path).toBe("visible.txt");
    });

    it("skips node_modules directory", async () => {
      const nodeModules = join(testDir, "node_modules");
      await mkdir(nodeModules, { recursive: true });
      await writeFile(join(nodeModules, "package.json"), "{}");
      await writeFile(join(testDir, "index.js"), "code");

      const result = await client.getTree();
      
      expect(result.tree).toHaveLength(1);
      expect(result.tree[0].path).toBe("index.js");
    });

    it("skips common build directories", async () => {
      const dist = join(testDir, "dist");
      const build = join(testDir, "build");
      await mkdir(dist, { recursive: true });
      await mkdir(build, { recursive: true });
      await writeFile(join(dist, "bundle.js"), "code");
      await writeFile(join(build, "output.js"), "code");
      await writeFile(join(testDir, "src.js"), "source");

      const result = await client.getTree();
      
      expect(result.tree).toHaveLength(1);
      expect(result.tree[0].path).toBe("src.js");
    });

    it("includes file size information", async () => {
      const content = "test content";
      await writeFile(join(testDir, "file.txt"), content);

      const result = await client.getTree();
      
      expect(result.tree).toHaveLength(1);
      expect(result.tree[0].size).toBe(Buffer.byteLength(content));
    });
  });

  describe("getBlob", () => {
    it("reads file content as base64", async () => {
      const filePath = join(testDir, "test.txt");
      const content = "Hello, World!";
      await writeFile(filePath, content);

      const blob = await client.getBlob(filePath);
      
      expect(blob.encoding).toBe("base64");
      expect(blob.size).toBe(Buffer.byteLength(content));
      
      const decoded = Buffer.from(blob.content, "base64").toString("utf-8");
      expect(decoded).toBe(content);
    });

    it("handles binary content", async () => {
      const filePath = join(testDir, "binary.bin");
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0xFF]);
      await writeFile(filePath, buffer);

      const blob = await client.getBlob(filePath);
      
      expect(blob.encoding).toBe("base64");
      const decoded = Buffer.from(blob.content, "base64");
      expect(decoded).toEqual(buffer);
    });
  });

  describe("getRepositoryName", () => {
    it("returns the directory name", () => {
      const name = client.getRepositoryName();
      expect(name).toMatch(/^local-client-test-\d+$/);
    });
  });

  describe("getRootPath", () => {
    it("returns the root path", () => {
      const path = client.getRootPath();
      expect(path).toBe(testDir);
    });
  });
});

