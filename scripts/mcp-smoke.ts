/**
 * Rökprov för MCP-servern över **riktig stdio** — samma väg Cline använder.
 * Startar servern som en subprocess, listar verktygen och anropar dem mot en
 * riktig video. Kräver nätverk, men ingen API-nyckel.
 *
 *   npm run mcp:smoke [video-url]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const url = process.argv[2] ?? "https://www.youtube.com/watch?v=45K3zHckCnQ";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/mcp/main.ts"],
  cwd: process.cwd(),
  stderr: "inherit",
});

const client = new Client({ name: "mcp-smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((tool) => tool.name).join(", ")}\n`);

const metadata = await client.callTool({
  name: "fetch_youtube_metadata",
  arguments: { url },
});
console.log("metadata:", JSON.stringify(JSON.parse(textOf(metadata)), null, 2));

const lang = process.env.YOUTUBE_INGEST_LANG ?? "en";
const transcript = await client.callTool({
  name: "fetch_youtube_transcript",
  arguments: { url, lang },
});
const parsed = JSON.parse(textOf(transcript)) as {
  language: string;
  segmentCount: number;
  truncated: boolean;
  text: string;
};
console.log("\ntranscript:", {
  language: parsed.language,
  segmentCount: parsed.segmentCount,
  truncated: parsed.truncated,
  chars: parsed.text.length,
});
console.log(`\nhead: ${parsed.text.slice(0, 200)}…`);

await client.close();

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const first = content[0] as { text?: string } | undefined;
  return typeof first?.text === "string" ? first.text : "";
}
