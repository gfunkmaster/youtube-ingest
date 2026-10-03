import { fetchTranscript, type TranscriptResponse } from "youtube-transcript";

import { collapseWhitespace, errorMessage } from "../util.js";
import { parseVideoId } from "./video-id.js";

export interface TranscriptResult {
  videoId: string;
  language: string;
  segmentCount: number;
  /** Full transcript as a single plain-text string. */
  text: string;
  /** True when `text` was cut at `maxChars`. */
  truncated: boolean;
  /** Length of the full transcript before any cap. */
  totalChars: number;
}

export interface TranscriptDeps {
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface TranscriptOptions {
  /** Preferred ISO 639-1 language; falls back to the video's default track. */
  lang?: string;
  /** Hard cap on transcript characters handed to the model. */
  maxChars?: number;
}

export const DEFAULT_MAX_CHARS = 120_000;

function toResult(
  videoId: string,
  segments: readonly TranscriptResponse[],
  fallbackLang: string | undefined,
  maxChars: number,
): TranscriptResult {
  const joined = segments
    .map((segment) => collapseWhitespace(segment.text))
    .filter((text) => text.length > 0)
    .join(" ");

  const truncated = joined.length > maxChars;

  return {
    videoId,
    language: segments[0]?.lang ?? fallbackLang ?? "unknown",
    segmentCount: segments.length,
    text: truncated ? joined.slice(0, maxChars) : joined,
    truncated,
    totalChars: joined.length,
  };
}

/**
 * Fetches the transcript via the `youtube-transcript` package (unofficial
 * InnerTube endpoint, no API key).
 *
 * Two deliberate behaviours:
 *
 * 1. **Language fallback.** The library returns whichever caption track YouTube
 *    lists first, which is often an auto-translated track in an unrelated
 *    language (a real English video came back in Bengali). This function tries
 *    the requested language, then English, then the video's default track, and
 *    reports the language that actually succeeded.
 *
 * 2. **No timestamps.** The library reports `offset`/`duration` in milliseconds
 *    for the srv3 caption format but in seconds for the legacy format — the
 *    units are not reliable — so timestamps are discarded rather than presented
 *    as facts.
 */
export async function fetchVideoTranscript(
  input: string,
  options: TranscriptOptions = {},
  deps: TranscriptDeps = {},
): Promise<TranscriptResult> {
  const videoId = parseVideoId(input);
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const preferred = [options.lang, "en"].filter(
    (lang): lang is string => typeof lang === "string" && lang.length > 0,
  );
  const attempts: (string | undefined)[] = [...new Set(preferred), undefined];

  const failures: string[] = [];
  for (const lang of attempts) {
    try {
      const segments = await fetchTranscript(videoId, {
        ...(lang ? { lang } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      if (segments.length > 0) {
        return toResult(videoId, segments, lang, maxChars);
      }
      failures.push(`${lang ?? "standard"}: inga segment`);
    } catch (error) {
      failures.push(`${lang ?? "standard"}: ${errorMessage(error)}`);
    }
  }

  throw new Error(
    `Kunde inte hämta någon transkription för ${videoId} (försökte: ${failures.join("; ")})`,
  );
}
