# Repository to Single File

A TypeScript CLI that processes a GitHub repository or local directory and concatenates all text-like files into one consolidated text document. The tool streams results into the `out/` directory.

## Prerequisites

- Node.js 18+
- For GitHub repositories: A GitHub personal access token with `repo` scope set as `GITHUB_TOKEN` in a local `.env` file

```
GITHUB_TOKEN=ghp_your_token_here
```

Note: The GitHub token is only required when processing GitHub repositories. For local directories, no token is needed.

## Installation

```bash
npm install
```

## Usage

### Process a GitHub Repository

Run the exporter with a GitHub URL:

```bash
npm run fetch -- https://github.com/owner/repository
```

Generate a PDF instead of plain text:

```bash
npm run fetch -- --pdf https://github.com/owner/repository
```

Select a specific branch or tag (defaults to the repository's default branch when omitted):

```bash
npm run fetch -- --branch release https://github.com/owner/repository
```

### Process a Local Directory

Run the exporter with a local path:

```bash
npm run fetch -- /path/to/local/directory
```

Or use a relative path:

```bash
npm run fetch -- ./my-project
```

Generate a PDF from a local directory:

```bash
npm run fetch -- --pdf ./my-project
```

The CLI will:

- **For GitHub repositories:**
  - Fetch repository metadata and estimate the number of API requests required
  - Warn if the upcoming run would exceed your remaining GitHub quota
  - Prompt for confirmation before downloading blobs
  - Export from the requested branch (or the default branch when none is provided)
- **For local directories:**
  - Scan the directory recursively for files
  - Skip hidden files/directories (starting with `.`) and common build directories (`node_modules`, `dist`, `build`, etc.)
  - Process files directly from disk
- **For both:**
  - Stream progress updates (`current/total`) while processing and when generating PDFs
  - Resume from previous attempts via cached checkpoints, so reruns only process missing files
  - Record source information in the output header for traceability
  - Write the final merged output into the `out/` directory as `<repo>-<branch>.txt` or `.pdf` (for local: `<dirname>-local.txt` or `.pdf`)

Tip: use `npm run build` to emit the compiled ESM bundle into `dist/` if you want to run the CLI directly via `node dist/main.js`.

## Testing

```bash
npm test
```

The Jest suite covers core helpers (URL parsing, text/binary detection, planning estimates, and progress reporting).

## Project Structure

- `main.ts` – CLI entry point
- `src/` – modular implementation (GitHub client, exporter, progress reporter, configuration)
- `out/` – generated output files
- `__tests__/` – Jest test suites for reusable modules

## Notes

- Large files (>5 MB) and likely-binary blobs are skipped automatically.
- Media, archive, and lock files (e.g. png, mp3, zip, gz, yarn.lock) are detected by extension and excluded pre-emptively.
- Downloads exit immediately if the GitHub rate limit is hit and automatically retry on transient network/5xx errors.
- When GitHub truncates the repository tree, the tool surfaces a warning in both the CLI and output footer.
- Concurrency defaults to 8 parallel blob requests; adjust `MAX_CONCURRENCY` in `src/config.ts` if needed.
- **For local directories:**
  - Hidden files and directories (starting with `.`) are automatically skipped.
  - Common build/dependency directories (`node_modules`, `dist`, `build`, `__pycache__`, `venv`, `.venv`) are automatically excluded.
  - Files are read directly from disk with no API rate limits.
