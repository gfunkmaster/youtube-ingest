#!/usr/bin/env node
import { errorMessage } from "../util.js";
import { runYoutubeMcpServer } from "./server.js";

const lang = process.env.YOUTUBE_INGEST_LANG;

// A stdio MCP server must keep stdout clean for the protocol — diagnostics go
// to stderr only, never to stdout.
runYoutubeMcpServer(lang ? { lang } : {}).catch((error: unknown) => {
  process.stderr.write(`youtube-ingest mcp: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
