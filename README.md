# GitHub Repository to Single File

A TypeScript CLI that fetches a GitHub repository and concatenates all text-like files into one consolidated text document. The tool streams results into the `out/` directory.

## Prerequisites

- Node.js 18+
- A GitHub personal access token with `repo` scope set as `GITHUB_TOKEN` in a local `.env` file

```
GITHUB_TOKEN=ghp_your_token_here
```

## Installation

```bash
npm install
```

## Usage

Run the exporter with:

```bash
npm run fetch -- https://github.com/owner/repository
```

The CLI will:

- Fetch repository metadata and estimate the number of API requests required
- Warn if the upcoming run would exceed your remaining GitHub quota
- Prompt for confirmation before downloading blobs
- Stream progress updates (`current/total`) while downloading
- Write the final merged output into the `out/` directory as `<repo>-<branch>.txt`

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
- When GitHub truncates the repository tree, the tool surfaces a warning in both the CLI and output footer.
- Concurrency defaults to 8 parallel blob requests; adjust `MAX_CONCURRENCY` in `src/config.ts` if needed.
