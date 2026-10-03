/**
 * Nätverksrökprov: kör de deterministiska verktygen mot en riktig video — utan
 * LLM och utan API-nyckel. Svarar på "fungerar YouTube-sidan av integrationen?".
 *
 *   npx tsx scripts/smoke.ts [video-url]
 */
import { createYoutubeTools } from "../src/tools/youtube.js";

const url = process.argv[2] ?? "https://www.youtube.com/watch?v=45K3zHckCnQ";
const context = { agentId: "smoke", iteration: 1 };
const lang = process.env.YOUTUBE_INGEST_LANG;

const [metadataTool, transcriptTool] = createYoutubeTools(lang ? { lang } : {});

console.log(`video: ${url}\n`);

const metadata = await metadataTool.execute({ url }, context);
console.log("metadata:", metadata);

const transcript = (await transcriptTool.execute({ url }, context)) as Record<string, unknown>;
if (typeof transcript.error === "string") {
  console.error("\ntranscript error:", transcript.error);
  process.exitCode = 1;
} else {
  const text = String(transcript.text ?? "");
  console.log("\ntranscript:", {
    language: transcript.language,
    segmentCount: transcript.segmentCount,
    chars: text.length,
    truncated: transcript.truncated,
  });
  console.log(`\nhead: ${text.slice(0, 240)}…`);
}
