import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseVideoId } from "./video-id.js";

/**
 * Local speech recognition fallback for videos without a usable caption track.
 *
 * YouTube-only ingest breaks in three cases: no captions at all, captions only in
 * an auto-translated language, or a caption track in the wrong language. All three
 * are what `transcribe-url` solves — it downloads the audio and runs Whisper
 * locally. This module is the thin adapter: run it, read the markdown it wrote,
 * hand the text back in the same shape as a caption track.
 *
 * Deliberate difference from captions: the ASR text keeps `- **mm:ss**` anchors,
 * because those timestamps come from the model and are trustworthy, while caption
 * timestamps were discarded in `transcript.ts` for unreliable units.
 */

export interface AsrTranscript {
  videoId: string;
  language: string;
  segmentCount: number;
  /** Transcript text; one `- **mm:ss** …` line per merged window. */
  text: string;
  truncated: boolean;
  totalChars: number;
  /** Distinguishes this from a caption track. */
  source: "asr";
}

export interface AsrRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI. Injected in tests so no process is spawned. */
export type AsrRunner = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<AsrRunResult>;

export interface AsrOptions {
  /** Preferred language, forwarded as `-l`. */
  lang?: string;
  /** Character cap for the text handed on (default 120 000, like captions). */
  maxChars?: number;
  /** Binary to run (default `TRANSCRIBE_ASR_BIN` or `transcribe-url`). */
  bin?: string;
  /** Hard timeout (default 30 minutes). */
  timeoutMs?: number;
  /** Injectable runner (tests). */
  run?: AsrRunner;
}

export const DEFAULT_MAX_CHARS = 120_000;
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const defaultRunner: AsrRunner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let code = 0;
        if (error !== null) {
          const raw = (error as { code?: unknown }).code;
          code = typeof raw === "number" ? raw : 1;
        }
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });

function lastLine(value: string): string {
  const lines = value.split("\n").filter((line) => line.trim().length > 0);
  const last = lines.length > 0 ? lines[lines.length - 1] : "";
  return last === undefined ? "" : last.trim();
}

interface AsrEvent {
  event?: unknown;
  path?: unknown;
  format?: unknown;
  message?: unknown;
}

/** Finds the rendered markdown path among the NDJSON events on stdout. */
export function markdownPathFromEvents(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: AsrEvent;
    try {
      event = JSON.parse(trimmed) as AsrEvent;
    } catch {
      continue;
    }
    if (event.event === "wrote" && event.format === "rendered" && typeof event.path === "string") {
      return event.path;
    }
  }
  return undefined;
}

export function errorFromEvents(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as AsrEvent;
      if (event.event === "error" && typeof event.message === "string") return event.message;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Splits frontmatter from body; returns `language:` plus the anchored bullets. */
export function parseRenderedMarkdown(markdown: string): {
  language: string;
  lines: string[];
} {
  let language = "";
  let body = markdown;
  if (markdown.startsWith("---")) {
    const end = markdown.indexOf("\n---", 3);
    if (end !== -1) {
      const frontmatter = markdown.slice(3, end);
      body = markdown.slice(end + 4);
      for (const raw of frontmatter.split("\n")) {
        const match = /^language:\s*(.*)$/.exec(raw.trim());
        if (match) language = (match[1] ?? "").replace(/^"|"$/g, "");
      }
    }
  }
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- **"));
  return { language, lines };
}

export async function transcribeWithAsr(
  input: string,
  options: AsrOptions = {},
): Promise<AsrTranscript> {
  const videoId = parseVideoId(input);
  const bin = options.bin ?? process.env.TRANSCRIBE_ASR_BIN ?? "transcribe-url";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const run = options.run ?? defaultRunner;

  const outdir = await mkdtemp(join(tmpdir(), "youtube-ingest-asr-"));
  try {
    const args = [
      "--json-events",
      "-f",
      "md",
      "--flat",
      "-o",
      outdir,
      ...(options.lang ? ["-l", options.lang] : []),
      input,
    ];
    const result = await run(bin, args, timeoutMs);

    if (result.code !== 0) {
      const reported = errorFromEvents(result.stdout) ?? lastLine(result.stderr);
      throw new Error(
        `${bin} misslyckades (kod ${result.code}) för ${videoId}: ${reported || "okänt fel"}`,
      );
    }

    const markdownPath = markdownPathFromEvents(result.stdout);
    if (!markdownPath) {
      throw new Error(`${bin} skrev ingen markdown för ${videoId}`);
    }

    const markdown = await readFile(markdownPath, "utf8");
    const { language, lines } = parseRenderedMarkdown(markdown);
    const full = lines.join("\n");
    if (full.trim().length === 0) {
      throw new Error(`${bin} hittade inget tal i ${videoId}`);
    }

    const truncated = full.length > maxChars;
    return {
      videoId,
      language: language.length > 0 ? language : (options.lang ?? "unknown"),
      segmentCount: lines.length,
      text: truncated ? full.slice(0, maxChars) : full,
      truncated,
      totalChars: full.length,
      source: "asr",
    };
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

