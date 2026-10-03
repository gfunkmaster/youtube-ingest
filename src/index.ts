#!/usr/bin/env node
import { parseArgs } from "node:util";

import { runIngestAgent, type AgentTools } from "./agent/run.js";
import { apiKeyHint, loadConfig } from "./config.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { createVaultTools } from "./tools/vault.js";
import { createYoutubeTools } from "./tools/youtube.js";
import { VIDEO_NOTES_SUBDIR } from "./vault/paths.js";
import { errorMessage } from "./util.js";

const USAGE = `youtube-ingest — för in en YouTube-video som källnot i Second Brain

Användning:
  youtube-ingest <youtube-url> [flaggor]

Flaggor:
  --dry-run            Skriv ingen fil; visa noten i terminalen i stället
  --force              Skriv över en befintlig not för samma video
  --lang <kod>         Föredraget transkriptspråk (t.ex. sv, en)
  --provider <id>      LLM-provider (standard: YOUTUBE_INGEST_PROVIDER eller anthropic)
  --model <id>         Modell (standard: YOUTUBE_INGEST_MODEL eller claude-sonnet-4-6)
  --vault <sökväg>     Valvets rot (standard: YOUTUBE_INGEST_VAULT)
  --out <undermapp>    Mapp för källnoter (standard: ${VIDEO_NOTES_SUBDIR})
  --max-iterations <n> Tak för agentens loop (standard: 12)
  -h, --help           Visa hjälp

Exempel:
  youtube-ingest "https://www.youtube.com/watch?v=45K3zHckCnQ"
  youtube-ingest "https://youtu.be/45K3zHckCnQ" --dry-run`;

interface ParsedCli {
  url: string | undefined;
  help: boolean;
  dryRun: boolean;
  force: boolean;
  lang: string | undefined;
  provider: string | undefined;
  model: string | undefined;
  vault: string | undefined;
  out: string | undefined;
  maxIterations: number | undefined;
}

function parseCli(argv: string[]): ParsedCli {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      lang: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      vault: { type: "string" },
      out: { type: "string" },
      "max-iterations": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const maxIterationsRaw = values["max-iterations"];
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : undefined;
  if (maxIterations !== undefined && (!Number.isFinite(maxIterations) || maxIterations < 1)) {
    throw new Error("--max-iterations måste vara ett positivt heltal");
  }

  return {
    url: positionals[0],
    help: values.help ?? false,
    dryRun: values["dry-run"] ?? false,
    force: values.force ?? false,
    lang: values.lang,
    provider: values.provider,
    model: values.model,
    vault: values.vault,
    out: values.out,
    maxIterations,
  };
}

/** Pulls the `output` of every tool-result for a given tool name. */
function toolOutputs(
  messages: readonly {
    content: readonly { type: string; toolName?: string; output?: unknown }[];
  }[],
  toolName: string,
): unknown[] {
  return messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool-result" && part.toolName === toolName)
    .map((part) => part.output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function main(): Promise<number> {
  let cli: ParsedCli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${USAGE}\n`);
    return 2;
  }

  if (cli.help || !cli.url) {
    process.stdout.write(`${USAGE}\n`);
    return cli.help ? 0 : 2;
  }

  const config = loadConfig();
  const providerId = cli.provider ?? config.providerId;
  const modelId = cli.model ?? config.modelId;

  if (!config.apiKey && !cli.provider) {
    process.stderr.write(
      `Ingen API-nyckel hittades för providern "${providerId}".\n` +
        `Sätt ${apiKeyHint(providerId)} (se .env.example) eller ange --provider ` +
        "för en nyckelfri provider.\n",
    );
    return 2;
  }

  const vaultDir = cli.vault ?? config.vaultDir;
  const notesSubdir = cli.out ?? VIDEO_NOTES_SUBDIR;
  const lang = cli.lang ?? config.lang;
  const today = new Date().toISOString().slice(0, 10);

  const youtubeTools = createYoutubeTools({ ...(lang ? { lang } : {}) });
  const vaultTools = createVaultTools({
    vaultDir,
    notesSubdir,
    today,
    dryRun: cli.dryRun,
    force: cli.force,
  });

  const tools = [...youtubeTools, ...vaultTools] as unknown as AgentTools;

  process.stdout.write(
    `Hämtar och bearbetar ${cli.url}\n` +
      `  provider: ${providerId} · modell: ${modelId} · valv: ${vaultDir}/${notesSubdir}\n` +
      (cli.dryRun ? "  läge: dry-run (inget skrivs)\n" : "") +
      "\n",
  );

  const result = await runIngestAgent({
    providerId,
    modelId,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    systemPrompt: buildSystemPrompt({ notesSubdir, today }),
    tools,
    prompt: buildUserPrompt(cli.url),
    ...(cli.maxIterations ? { maxIterations: cli.maxIterations } : {}),
    onText: (delta) => process.stdout.write(delta),
  });

  process.stdout.write("\n");

  const lastWrite = toolOutputs(result.messages, "write_source_note").at(-1);

  if (isRecord(lastWrite)) {
    if (typeof lastWrite.error === "string") {
      process.stderr.write(`\nFel: ${lastWrite.error}\n`);
    } else if (lastWrite.dryRun === true && typeof lastWrite.preview === "string") {
      process.stdout.write(
        `\n--- dry-run: ${String(lastWrite.path)} ---\n${lastWrite.preview}\n`,
      );
    } else if (lastWrite.written === true) {
      process.stdout.write(`\nKällnot skriven: ${String(lastWrite.path)}\n`);
    } else if (typeof lastWrite.reason === "string") {
      process.stdout.write(`\nIngen not skriven: ${lastWrite.reason}\n`);
    }
  }

  if (result.status === "failed") {
    const detail = result.error ? errorMessage(result.error) : "okänt fel";
    process.stderr.write(`\nKörningen misslyckades: ${detail}\n`);
  }

  const cost = result.usage.totalCost;
  process.stdout.write(
    `\nStatus: ${result.status} · iterationer: ${result.iterations}` +
      (typeof cost === "number" ? ` · kostnad: $${cost.toFixed(4)}` : "") +
      "\n",
  );

  return result.status === "completed" ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Oväntat fel: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
