import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { errorMessage } from "../util.js";
import { fetchVideoMetadata } from "../youtube/metadata.js";
import { fetchVideoTranscript } from "../youtube/transcript.js";

export const MCP_SERVER_NAME = "youtube-ingest";
export const MCP_SERVER_VERSION = "0.1.0";

export interface McpServerDeps {
  /** Injectable fetch for tests. */
  fetch?: typeof globalThis.fetch;
  /** Preferred transcript language. */
  lang?: string;
  /** Character cap for the transcript. */
  maxChars?: number;
}

function jsonText(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorText(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return { content: [{ type: "text", text: errorMessage(error) }], isError: true };
}

/**
 * MCP server exposing the two *deterministic* YouTube lookups. It reuses the
 * exact same implementation functions as the Cline agent tools — one
 * implementation, two adapters — so behaviour cannot drift between them.
 *
 * Tool descriptions are in English because MCP is a protocol-level surface that
 * any client may consume; the vault-facing prompts stay Swedish.
 */
export function createYoutubeMcpServer(deps: McpServerDeps = {}): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  const metadataDeps = deps.fetch ? { fetch: deps.fetch } : {};
  const transcriptDeps = deps.fetch ? { fetch: deps.fetch } : {};

  server.registerTool(
    "fetch_youtube_metadata",
    {
      title: "Fetch YouTube metadata",
      description:
        "Fetch the title, channel and thumbnail of a YouTube video via oEmbed. " +
        "Accepts a YouTube URL or an 11-character video id. No API key required.",
      inputSchema: {
        url: z
          .string()
          .describe("YouTube URL (watch, youtu.be, shorts, live, embed) or an 11-char video id."),
      },
    },
    async ({ url }) => {
      try {
        return jsonText(await fetchVideoMetadata(url, metadataDeps));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "fetch_youtube_transcript",
    {
      title: "Fetch YouTube transcript",
      description:
        "Fetch a video's caption track as one plain-text string. Tries the requested " +
        "language, then English, then the video's default track, and reports which was " +
        "used in `language`. Timestamps are omitted because the underlying library's " +
        "offset units are not reliable.",
      inputSchema: {
        url: z.string().describe("YouTube URL or an 11-char video id."),
        lang: z
          .string()
          .optional()
          .describe("Preferred ISO 639-1 language code, e.g. 'en' or 'sv'."),
      },
    },
    async ({ url, lang }) => {
      try {
        const effectiveLang = lang ?? deps.lang;
        return jsonText(
          await fetchVideoTranscript(
            url,
            {
              ...(effectiveLang ? { lang: effectiveLang } : {}),
              ...(deps.maxChars ? { maxChars: deps.maxChars } : {}),
            },
            transcriptDeps,
          ),
        );
      } catch (error) {
        return errorText(error);
      }
    },
  );

  return server;
}

/**
 * Runs the server over stdio. Note: a stdio MCP server must keep stdout clean
 * for the protocol, so nothing here may write to stdout.
 */
export async function runYoutubeMcpServer(deps: McpServerDeps = {}): Promise<void> {
  const server = createYoutubeMcpServer(deps);
  await server.connect(new StdioServerTransport());
}
