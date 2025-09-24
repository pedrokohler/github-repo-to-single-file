import { SKIP_EXTENSIONS, TEXT_EXTENSIONS } from "./config.js";

function extractExtension(path: string): string | null {
  const lower = path.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  return lastDot >= 0 ? lower.slice(lastDot) : null;
}

export function hasSkippedExtension(path: string): boolean {
  const ext = extractExtension(path);
  return Boolean(ext && SKIP_EXTENSIONS.has(ext));
}

export function looksTexty(path: string, bytes: Uint8Array): boolean {
  const ext = extractExtension(path);
  if (ext) {
    if (SKIP_EXTENSIONS.has(ext)) return false;
    if (TEXT_EXTENSIONS.has(ext)) return true;
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  if (sample.length === 0) return true;

  const nonPrintable = sample.reduce((count, byte) => {
    if (byte === 9 || byte === 10 || byte === 13) return count;
    if (byte < 32 || byte === 0) return count + 1;
    return count;
  }, 0);

  return nonPrintable / sample.length < 0.1;
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\n/g, "");
  return new Uint8Array(Buffer.from(clean, "base64"));
}

export function headerFor(path: string): string {
  const separator = "=".repeat(80);
  return `\n${separator}\nFILE: ${path}\n${separator}\n`;
}

export function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
