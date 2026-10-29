import { createTool } from "@cline/sdk";

import type { IngestSession } from "../session.js";
import { errorMessage } from "../util.js";
import { transcribeWithAsr, type AsrRunner } from "../youtube/asr.js";
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
  /**
   * Local ASR fallback (transcribe-url) for videos without usable captions.
   *
   * Fires when the caption track is missing. It cannot detect an auto-translated
   * track: `youtube-transcript` never reports the track's real language, only the
   * one requested — so a garbled/wrong-language track has to be forced with
   * `force` (or `YOUTUBE_INGEST_ASR=always`).
   *
   * Enabled by default; `YOUTUBE_INGEST_ASR=0` or `{ enabled: false }` turns it off.
   */
  asr?: {
    enabled?: boolean;
    force?: boolean;
    bin?: string;
    timeoutMs?: number;
    run?: AsrRunner;
  };
}

/** A transcript can come from a caption track or from local speech recognition. */
interface TranscriptOutcome {
  videoId: string;
  language: string;
  segmentCount: number;
  text: string;
  truncated: boolean;
  totalChars: number;
  source: "captions" | "asr";
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
      const requestedLang = deps.lang;
      const asrEnv = process.env.YOUTUBE_INGEST_ASR;
      const asrEnabled = deps.asr?.enabled ?? asrEnv !== "0";
      const asrForced = deps.asr?.force ?? asrEnv === "always";

      const runAsr = async (): Promise<TranscriptOutcome> => {
        const asr = await transcribeWithAsr(input.url, {
          ...(requestedLang ? { lang: requestedLang } : {}),
          ...(deps.maxChars ? { maxChars: deps.maxChars } : {}),
          ...(deps.asr?.bin ? { bin: deps.asr.bin } : {}),
          ...(deps.asr?.timeoutMs ? { timeoutMs: deps.asr.timeoutMs } : {}),
          ...(deps.asr?.run ? { run: deps.asr.run } : {}),
        });
        return {
          videoId: asr.videoId,
          language: asr.language,
          segmentCount: asr.segmentCount,
          text: asr.text,
          truncated: asr.truncated,
          totalChars: asr.totalChars,
          source: "asr",
        };
      };

      try {
        let result: TranscriptOutcome;
        if (asrEnabled && asrForced) {
          // Explicitly asked for local ASR (garbled or auto-translated captions).
          result = await runAsr();
        } else {
          try {
            const caption = await fetchVideoTranscript(
              input.url,
              {
                ...(deps.lang ? { lang: deps.lang } : {}),
                ...(deps.maxChars ? { maxChars: deps.maxChars } : {}),
              },
              transcriptDeps,
            );
            result = {
              videoId: caption.videoId,
              language: caption.language,
              segmentCount: caption.segmentCount,
              text: caption.text,
              truncated: caption.truncated,
              totalChars: caption.totalChars,
              source: "captions",
            };
          } catch (captionError) {
            // No caption track at all: this is what the ASR fallback exists for.
            if (!asrEnabled) throw captionError;
            result = await runAsr();
          }
        }

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
            source: result.source,
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
