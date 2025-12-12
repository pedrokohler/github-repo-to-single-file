import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import type { GitTreeItem, BlobResponse } from "./types.js";

export class LocalFileSystemClient {
  constructor(private readonly rootPath: string) {}

  async getTree(): Promise<{ tree: GitTreeItem[]; truncated: boolean }> {
    const items: GitTreeItem[] = [];
    
    async function walkDirectory(currentPath: string, relativeTo: string): Promise<void> {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const relativePath = relative(relativeTo, fullPath);
        
        // Skip hidden files and directories (e.g., .git)
        if (entry.name.startsWith(".")) {
          continue;
        }
        
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === "__pycache__" ||
          entry.name === "venv" ||
          entry.name === ".venv"
        ) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await walkDirectory(fullPath, relativeTo);
        } else if (entry.isFile()) {
          try {
            const stats = await stat(fullPath);
            items.push({
              path: relativePath,
              mode: "100644",
              type: "blob",
              sha: fullPath,
              size: stats.size,
              url: fullPath,
            });
          } catch (error) {
            console.warn(`Warning: Could not access ${relativePath}`);
          }
        }
      }
    }
    
    await walkDirectory(this.rootPath, this.rootPath);
    return { tree: items, truncated: false };
  }

  async getBlob(sha: string): Promise<BlobResponse> {
    const content = await readFile(sha);
    const base64Content = content.toString("base64");
    
    return {
      content: base64Content,
      encoding: "base64",
      size: content.length,
    };
  }

  getRepositoryName(): string {
    return basename(this.rootPath);
  }

  getRootPath(): string {
    return this.rootPath;
  }
}

