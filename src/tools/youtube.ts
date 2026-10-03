import { createTool } from "@cline/sdk";

import type { IngestSession } from "../session.js";
import { errorMessage } from "../util.js";
import { fetchVideoMetadata } from "../youtube/metadata.js";
import { fetchVideoTranscript } from "../youtube/transcript.js";

export interface YoutubeToolDeps {
  /** Injectable fetch for tests (metadata + transcript). */
  fetch?: typeof globalThis.fetch;
  /** Preferred transcript language. */
  lang?: string;
  /** Character cap for the transcript handed to the model. */
  maxChars?: number;
  /** When given, the fetched transcript is handed over for the note tool. */
  session?: IngestSession;
}

interface UrlInput {
  url: string;
}

/**
 * Deterministic YouTube tools. They only fetch and normalise data — no model
 * output flows back into them, and they never throw: recoverable failures are
 * returned as `{ error }` so the agent can decide what to do.
 */
export function createYoutubeTools(deps: YoutubeToolDeps = {}) {
  const metadataDeps = deps.fetch ? { fetch: deps.fetch } : {};
  const transcriptDeps = deps.fetch ? { fetch: deps.fetch } : {};

  const fetchYoutubeMetadata = createTool({
    name: "fetch_youtube_metadata",
    description:
      "Hämtar titel, kanalnamn och thumbnail för en YouTube-video via oEmbed. " +
      "Tar emot en YouTube-URL eller ett 11-tecken video-ID.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "YouTube-URL (watch, youtu.be, shorts, embed) eller video-ID.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (input: UrlInput) => {
      try {
        return await fetchVideoMetadata(input.url, metadataDeps);
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
  });

  const fetchYoutubeTranscript = createTool({
    name: "fetch_youtube_transcript",
    description:
      "Hämtar videons transkript (undertextspår) som en enda textsträng. " +
      "Returnerar språk, antal segment och om texten kapades.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "YouTube-URL eller video-ID.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (input: UrlInput) => {
      try {
        const result = await fetchVideoTranscript(
          input.url,
          {
            ...(deps.lang ? { lang: deps.lang } : {}),
            ...(deps.maxChars ? { maxChars: deps.maxChars } : {}),
          },
          transcriptDeps,
        );

        // Hand the source text straight to the note tool. Going through the model
        // instead would cost 120k output tokens and let it paraphrase the source.
        if (deps.session) {
          deps.session.transcript = {
            videoId: result.videoId,
            language: result.language,
            text: result.text,
            truncated: result.truncated,
            chars: result.text.length,
            totalChars: result.totalChars,
          };
        }

        return result;
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
  });

  return [fetchYoutubeMetadata, fetchYoutubeTranscript] as const;
}
