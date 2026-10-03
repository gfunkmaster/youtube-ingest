import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createYoutubeMcpServer, type McpServerDeps } from "../src/mcp/server.js";

const URL = "https://www.youtube.com/watch?v=45K3zHckCnQ";

type FetchInput = Parameters<typeof globalThis.fetch>[0];

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  return typeof (input as Request).url === "string" ? (input as Request).url : String(input);
}

/** oEmbed + InnerTube/timedtext, faked so the test never touches the network. */
const fakeFetch: typeof globalThis.fetch = async (input) => {
  const url = requestUrl(input);

  if (url.includes("oembed")) {
    return new Response(
      JSON.stringify({ title: "Test Title", author_name: "Test Channel" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  if (url.includes("/youtubei/v1/player")) {
    return new Response(
      JSON.stringify({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://www.youtube.com/api/timedtext?v=45K3zHckCnQ&lang=en",
                languageCode: "en",
              },
            ],
          },
        },
      }),
      { status: 200 },
    );
  }

  return new Response(
    '<transcript><text start="0" dur="2">Hello from MCP</text></transcript>',
    { status: 200 },
  );
};

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const first = content[0] as { type?: string; text?: string } | undefined;
  return typeof first?.text === "string" ? first.text : "";
}

async function connect(deps: McpServerDeps) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createYoutubeMcpServer(deps);
  const client = new Client({ name: "youtube-ingest-test", version: "0.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

describe("youtube MCP server", () => {
  it("advertises both deterministic tools", async () => {
    const { client, server } = await connect({ fetch: fakeFetch });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "fetch_youtube_metadata",
        "fetch_youtube_transcript",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns metadata as JSON text", async () => {
    const { client, server } = await connect({ fetch: fakeFetch });
    try {
      const result = await client.callTool({
        name: "fetch_youtube_metadata",
        arguments: { url: URL },
      });

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(textOf(result))).toMatchObject({
        videoId: "45K3zHckCnQ",
        title: "Test Title",
        author: "Test Channel",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns the transcript as JSON text", async () => {
    const { client, server } = await connect({ fetch: fakeFetch });
    try {
      const result = await client.callTool({
        name: "fetch_youtube_transcript",
        arguments: { url: URL, lang: "en" },
      });

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(textOf(result))).toMatchObject({
        language: "en",
        segmentCount: 1,
      });
      expect(textOf(result)).toContain("Hello from MCP");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reports tool errors instead of throwing", async () => {
    const { client, server } = await connect({ fetch: fakeFetch });
    try {
      const result = await client.callTool({
        name: "fetch_youtube_metadata",
        arguments: { url: "not-a-url" },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("video-ID");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
