import { config as loadEnv } from "dotenv";

let envLoaded = false;

export function ensureEnvironment(): void {
  if (!envLoaded) {
    loadEnv();
    envLoaded = true;
  }
}

export function resolveGitHubToken(): string | undefined {
  ensureEnvironment();
  const token = process.env.GITHUB_TOKEN?.trim();
  return token || undefined;
}
