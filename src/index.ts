#!/usr/bin/env node
import { basename } from "node:path";
import { parseArgs } from "node:util";

import {
  describeNoNote,
  isRecord,
  toolCallNames,
  toolOutputs,
} from "./agent/diagnose.js";
import { runIngestAgent, type AgentTools } from "./agent/run.js";
import {
  listProviders,
  loadConfig,
  modelExistsForProvider,
  UnknownProviderError,
  type AppConfig,
} from "./config.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { createVaultTools } from "./tools/vault.js";
import { createYoutubeTools } from "./tools/youtube.js";
import { createIngestSession } from "./session.js";
import { writeSourceHub } from "./vault/hub.js";
import { VIDEO_NOTES_SUBDIR } from "./vault/paths.js";
import { fetchPlaylistItems, type PlaylistItem } from "./youtube/playlist.js";
import { parseVideoId, playlistIdOf } from "./youtube/video-id.js";
import { errorMessage } from "./util.js";

const USAGE = `youtube-ingest — för in en YouTube-video som källnot i Second Brain

Användning:
  youtube-ingest <youtube-url> [flaggor]

Flaggor:
  --dry-run            Skriv ingen fil; visa noten i terminalen i stället
  --force              Skriv över en befintlig not för samma video
  --no-transcript      Lägg inte in transkriptet i noten (mindre filer)
  --playlist           Kör hela spellistan, inte bara videon i URL:en
  --max-videos <n>     Tak för antal videor i en spellista (standard: 10)
  --verbose            Visa vilka verktyg modellen faktiskt anropade
  --lang <kod>         Föredraget transkriptspråk (t.ex. sv, en)
  --provider <id>      LLM-provider (standard: YOUTUBE_INGEST_PROVIDER eller anthropic)
  --model <id>         Modell (standard: providerns defaultModelId i SDK-registret)
  --vault <sökväg>     Valvets rot (standard: YOUTUBE_INGEST_VAULT)
  --out <undermapp>    Mapp för källnoter (standard: ${VIDEO_NOTES_SUBDIR})
  --max-iterations <n> Tak för agentens loop (standard: 12)
  --list-providers     Lista alla LLM-providers SDK:n känner till (t.ex. deepseek)
  -h, --help           Visa hjälp

Providern är valfri: Cline SDK innehåller ett par hundra. Nyckelns miljövariabel
läses ur SDK-registret (deepseek -> DEEPSEEK_API_KEY, groq -> GROQ_API_KEY, ...).

Exempel:
  youtube-ingest "https://www.youtube.com/watch?v=45K3zHckCnQ" --dry-run
  youtube-ingest "https://youtu.be/45K3zHckCnQ" --provider deepseek
  youtube-ingest --list-providers`;

interface ParsedCli {
  url: string | undefined;
  help: boolean;
  listProviders: boolean;
  dryRun: boolean;
  force: boolean;
  noTranscript: boolean;
  playlist: boolean;
  maxVideos: number | undefined;
  verbose: boolean;
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
      "no-transcript": { type: "boolean", default: false },
      playlist: { type: "boolean", default: false },
      "max-videos": { type: "string" },
      verbose: { type: "boolean", default: false },
      lang: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      vault: { type: "string" },
      out: { type: "string" },
      "max-iterations": { type: "string" },
      "list-providers": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const maxIterationsRaw = values["max-iterations"];
  const maxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : undefined;
  if (maxIterations !== undefined && (!Number.isFinite(maxIterations) || maxIterations < 1)) {
    throw new Error("--max-iterations måste vara ett positivt heltal");
  }

  const maxVideosRaw = values["max-videos"];
  const maxVideos = maxVideosRaw ? Number.parseInt(maxVideosRaw, 10) : undefined;
  if (maxVideos !== undefined && (!Number.isFinite(maxVideos) || maxVideos < 1)) {
    throw new Error("--max-videos måste vara ett positivt heltal");
  }

  return {
    url: positionals[0],
    help: values.help ?? false,
    listProviders: values["list-providers"] ?? false,
    dryRun: values["dry-run"] ?? false,
    force: values.force ?? false,
    noTranscript: values["no-transcript"] ?? false,
    playlist: values.playlist ?? false,
    maxVideos,
    verbose: values.verbose ?? false,
    lang: values.lang,
    provider: values.provider,
    model: values.model,
    vault: values.vault,
    out: values.out,
    maxIterations,
  };
}

/**
 * Keeps a dry-run preview readable when the note carries a full transcript.
 * The elision is stated explicitly so the preview never pretends to be the file.
 */
function previewForTerminal(markdown: string): string {
  const marker = "\n## Transkript\n";
  const at = markdown.indexOf(marker);
  if (at === -1) return markdown;

  const head = markdown.slice(0, at);
  const rest = markdown.slice(at + marker.length);
  const nextSection = rest.indexOf("\n## ");
  const body = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const tail = nextSection === -1 ? "" : rest.slice(nextSection);

  return (
    `${head}${marker}` +
    `<!-- förhandsvisning: transkriptet utelämnat här (${body.trim().length} tecken ` +
    `finns i filen) -->${tail}`
  );
}

/** Prints every provider in the SDK registry (`--list-providers`). */
async function printProviders(): Promise<number> {
  const providers = await listProviders();
  const withKey = providers.filter((provider) => provider.hasKey).length;

  const rows = providers.map((provider) => {
    const marker = provider.isDefault ? "*" : " ";
    const key = provider.hasKey ? "✓" : " ";
    return `${marker} ${key}  ${provider.id.padEnd(26)} ${provider.defaultModelId.padEnd(30)} ${provider.envNames.join(", ")}`;
  });

  process.stdout.write(
    `Providers i Cline SDK: ${providers.length} st (* = standard, ✓ = nyckel finns i miljön)\n\n` +
      `      ${"id".padEnd(26)} ${"defaultModelId".padEnd(30)} nyckelvariabel\n` +
      `${rows.join("\n")}\n\n` +
      `Välj med YOUTUBE_INGEST_PROVIDER=<id> i .env, eller --provider <id>.\n` +
      `Nycklar hittade i miljön just nu: ${withKey}.\n`,
  );
  return 0;
}

interface IngestOutcome {
  videoId: string;
  title: string;
  noteName?: string;
  skippedReason?: string;
}

export interface RunPlaylistContext {
  url: string;
  playlistId: string;
  config: AppConfig;
  cli: ParsedCli;
  today: string;
  notesSubdir: string;
}

/**
 * Runs the existing single-video flow once per playlist entry, then writes a hub
 * note. Each video gets a FRESH session, so a transcript can never leak from one
 * video into another's note. One video failing never aborts the batch.
 */
async function runPlaylist(context: RunPlaylistContext): Promise<number> {
  const { config, cli, today, notesSubdir } = context;

  let items: PlaylistItem[];
  try {
    items = await fetchPlaylistItems(context.url, {
      ...(cli.maxVideos ? { limit: cli.maxVideos } : {}),
    });
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  if (items.length === 0) {
    process.stderr.write("Spellistan innehöll inga videor.\n");
    return 1;
  }

  const playlistTitle = items[0]?.playlistTitle ?? `Spellista ${context.playlistId}`;

  process.stdout.write(
    `Spellista: ${playlistTitle}\n` +
      `  ${items.length} videor — en LLM-körning per video. Ctrl-C avbryter.\n` +
      (cli.dryRun ? "  läge: dry-run (inget skrivs)\n" : "") +
      "\n",
  );

  const outcomes: IngestOutcome[] = [];

  for (const [index, item] of items.entries()) {
    const videoUrl = `https://www.youtube.com/watch?v=${item.videoId}`;
    process.stdout.write(`[${index + 1}/${items.length}] ${item.videoId} … `);

    try {
      const session = createIngestSession();
      const tools = [
        ...createYoutubeTools({ ...(config.lang ? { lang: config.lang } : {}), session }),
        ...createVaultTools({
          vaultDir: config.vaultDir,
          notesSubdir,
          today,
          dryRun: cli.dryRun,
          force: cli.force,
          session,
          includeTranscript: !cli.noTranscript,
        }),
      ] as unknown as AgentTools;

      const result = await runIngestAgent({
        providerId: config.providerId,
        modelId: config.modelId,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        systemPrompt: buildSystemPrompt({ notesSubdir, today }),
        tools,
        prompt: buildUserPrompt(videoUrl),
        ...(cli.maxIterations ? { maxIterations: cli.maxIterations } : {}),
        requiredTool: "write_source_note",
      });

      const last = toolOutputs(result.messages, "write_source_note").at(-1);
      const path = isRecord(last) && typeof last.path === "string" ? last.path : undefined;
      const wrote = isRecord(last) && last.written === true && path !== undefined;

      if (wrote && path) {
        const noteName = basename(path, ".md");
        process.stdout.write(`not: ${noteName}\n`);
        outcomes.push({ videoId: item.videoId, title: noteName, noteName });
      } else {
        // "run completed" is not a reason. Name the actual cause instead.
        const reason = describeNoNote(result.messages, result.status);
        process.stdout.write(`ingen not: ${reason}\n`);
        outcomes.push({ videoId: item.videoId, title: item.videoId, skippedReason: reason });
      }

      if (cli.verbose) {
        const calls = toolCallNames(result.messages);
        process.stdout.write(
          `      verktyg: ${calls.length > 0 ? calls.join(" → ") : "(inga)"}\n`,
        );
      }
    } catch (error) {
      const reason = errorMessage(error);
      process.stdout.write(`fel: ${reason}\n`);
      outcomes.push({ videoId: item.videoId, title: item.videoId, skippedReason: reason });
    }
  }

  let hubLine = "";
  try {
    const hub = await writeSourceHub({
      vaultDir: config.vaultDir,
      title: playlistTitle,
      url: context.url,
      ingested: today,
      entries: outcomes.map((outcome) => ({
        title: outcome.title,
        videoId: outcome.videoId,
        ...(outcome.noteName ? { noteName: outcome.noteName } : {}),
        ...(outcome.skippedReason ? { skippedReason: outcome.skippedReason } : {}),
      })),
      dryRun: cli.dryRun,
    });
    hubLine = `${hub.written ? "Hub-not skriven" : "Hub-not (dry-run)"}: ${hub.path}\n`;
  } catch (error) {
    process.stderr.write(`Kunde inte skriva hub-noten: ${errorMessage(error)}\n`);
  }

  const written = outcomes.filter((outcome) => outcome.noteName).length;
  process.stdout.write(
    `\nKlart: ${written} källnot${written === 1 ? "" : "er"} skrivna, ` +
      `${outcomes.length - written} hoppade över.\n${hubLine}`,
  );

  return written > 0 ? 0 : 1;
}

async function main(): Promise<number> {
  let cli: ParsedCli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${USAGE}\n`);
    return 2;
  }

  if (cli.listProviders) return printProviders();

  if (cli.help || !cli.url) {
    process.stdout.write(`${USAGE}\n`);
    return cli.help ? 0 : 2;
  }

  // A URL can carry a playlist (`list=...`). Either it has no video at all —
  // which this app cannot handle — or it has one, in which case say plainly that
  // the rest of the playlist is ignored rather than dropping it silently.
  const playlistId = playlistIdOf(cli.url);
  let videoId: string | undefined;
  try {
    videoId = parseVideoId(cli.url);
  } catch {
    videoId = undefined;
  }

  // Playlist mode: a bare playlist URL, or --playlist on a URL carrying both.
  // Otherwise `watch?v=…&list=…` stays single-video — but says so out loud.
  const playlistMode = playlistId !== undefined && (!videoId || cli.playlist);

  if (!videoId && !playlistMode) {
    process.stderr.write(`Hittade inget YouTube-video-ID i: ${cli.url}\n`);
    return 2;
  }

  if (!playlistMode && playlistId) {
    process.stderr.write(
      `OBS: URL:en innehåller en spellista (list=${playlistId}). Bara videon ` +
        `${videoId} förs in — använd --playlist för hela spellistan.\n\n`,
    );
  }

  let config: AppConfig;
  try {
    config = await loadConfig(process.env, {
      ...(cli.provider ? { providerId: cli.provider } : {}),
      ...(cli.model ? { modelId: cli.model } : {}),
      ...(cli.vault ? { vaultDir: cli.vault } : {}),
      ...(cli.lang ? { lang: cli.lang } : {}),
    });
  } catch (error) {
    if (error instanceof UnknownProviderError) {
      process.stderr.write(`${errorMessage(error)}\n`);
      return 2;
    }
    throw error;
  }

  const { providerId, modelId } = config;

  if (config.requiresApiKey && !config.apiKey) {
    process.stderr.write(
      `Ingen API-nyckel hittades för providern "${providerId}".\n` +
        `Sätt ${config.apiKeyEnvNames.join(" eller ")} i .env (se .env.example).\n` +
        'Providern kommer från SDK-registret — "npm run dev -- --list-providers" visar alla.\n',
    );
    return 2;
  }

  // Guard against a stale YOUTUBE_INGEST_MODEL from another provider — e.g.
  // switching to deepseek while an Anthropic model id is still set.
  if (config.modelIdIsExplicit) {
    const known = await modelExistsForProvider(providerId, modelId);
    if (known === false) {
      process.stderr.write(
        `Varning: modellen "${modelId}" finns inte bland modellerna för providern ` +
          `"${providerId}". Providerns standard är "${config.providerDefaultModelId}" — ` +
          "ta bort YOUTUBE_INGEST_MODEL (eller --model) för att använda den.\n\n",
      );
    }
  }

  const { vaultDir } = config;
  const notesSubdir = cli.out ?? VIDEO_NOTES_SUBDIR;
  const lang = config.lang;
  const today = new Date().toISOString().slice(0, 10);

  if (playlistMode && playlistId) {
    return runPlaylist({ url: cli.url, playlistId, config, cli, today, notesSubdir });
  }

  const session = createIngestSession();
  const youtubeTools = createYoutubeTools({ ...(lang ? { lang } : {}), session });
  const vaultTools = createVaultTools({
    vaultDir,
    notesSubdir,
    today,
    dryRun: cli.dryRun,
    force: cli.force,
    session,
    includeTranscript: !cli.noTranscript,
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
    requiredTool: "write_source_note",
    onText: (delta) => process.stdout.write(delta),
  });

  process.stdout.write("\n");

  const lastWrite = toolOutputs(result.messages, "write_source_note").at(-1);

  if (isRecord(lastWrite)) {
    if (typeof lastWrite.error === "string") {
      process.stderr.write(`\nFel: ${lastWrite.error}\n`);
    } else if (lastWrite.dryRun === true && typeof lastWrite.preview === "string") {
      process.stdout.write(
        `\n--- dry-run: ${String(lastWrite.path)} ---\n` +
          `${previewForTerminal(lastWrite.preview)}\n`,
      );
    } else if (lastWrite.written === true) {
      process.stdout.write(`\nKällnot skriven: ${String(lastWrite.path)}\n`);
    } else if (typeof lastWrite.reason === "string") {
      process.stdout.write(`\nIngen not skriven: ${lastWrite.reason}\n`);
    }
  } else {
    // The model never called the note tool at all — say why, not "completed".
    process.stderr.write(
      `\nIngen not skriven: ${describeNoNote(result.messages, result.status)}\n`,
    );
  }

  if (cli.verbose) {
    const calls = toolCallNames(result.messages);
    process.stdout.write(
      `Verktyg: ${calls.length > 0 ? calls.join(" → ") : "(inga)"}\n`,
    );
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
