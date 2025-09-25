import { join, resolve, dirname } from "node:path";
import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { OUT_DIR } from "./config.js";

type RepoIdentity = {
  coordinates: { owner: string };
  repoName: string;
  branch: string;
};

const WORK_SUBDIR = ".work";

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function workDirectoryFor(outline: RepoIdentity): string {
  const owner = sanitizeSegment(outline.coordinates.owner);
  const repo = sanitizeSegment(outline.repoName);
  const branch = sanitizeSegment(outline.branch);
  return join(OUT_DIR, WORK_SUBDIR, `${owner}--${repo}--${branch}`);
}

function resolveWithin(base: string, relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "");
  const full = resolve(base, cleaned);
  if (!full.startsWith(resolve(base))) {
    throw new Error(`Resolved path escapes work directory: ${relativePath}`);
  }
  return full;
}

async function statIfFile(path: string): Promise<boolean> {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureWorkDirectory(outline: RepoIdentity): Promise<string> {
  const dir = workDirectoryFor(outline);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readCachedFile(
  outline: RepoIdentity,
  filePath: string
): Promise<string | null> {
  const workDir = workDirectoryFor(outline);
  const absolute = resolveWithin(workDir, filePath);
  if (!(await statIfFile(absolute))) {
    return null;
  }
  const buf = await readFile(absolute);
  return buf.toString("utf8");
}

export async function writeCachedFile(
  outline: RepoIdentity,
  filePath: string,
  content: string
): Promise<void> {
  const workDir = await ensureWorkDirectory(outline);
  const absolute = resolveWithin(workDir, filePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

export async function cleanupWorkDirectory(outline: RepoIdentity): Promise<void> {
  const dir = workDirectoryFor(outline);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures
  }
}

export async function hasCachedFile(
  outline: RepoIdentity,
  filePath: string
): Promise<boolean> {
  const dir = workDirectoryFor(outline);
  return statIfFile(resolveWithin(dir, filePath));
}

export async function countCachedFiles(
  outline: RepoIdentity,
  filePaths: readonly string[]
): Promise<number> {
  const dir = await ensureWorkDirectory(outline);
  const results = await Promise.all(
    filePaths.map((path) => statIfFile(resolveWithin(dir, path)))
  );
  return results.filter(Boolean).length;
}
