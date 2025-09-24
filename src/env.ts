import { config as loadEnv } from "dotenv";

let envLoaded = false;

export function ensureEnvironment(): void {
  if (!envLoaded) {
    loadEnv();
    envLoaded = true;
  }
}

export function resolveGitHubToken(): string {
  ensureEnvironment();
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing GITHUB_TOKEN. Add it to your .env file and rerun the script."
    );
  }
  return token;
}
