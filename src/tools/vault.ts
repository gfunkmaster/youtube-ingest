import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { createTool } from "@cline/sdk";

import { errorMessage } from "../util.js";
import { VIDEO_NOTES_SUBDIR, videoNotesDir } from "../vault/paths.js";
import { buildSourceNote, sourceNoteFileName } from "../vault/note.js";
import { parseVideoId } from "../youtube/video-id.js";

export interface VaultToolOptions {
  /** Absolute path to the vault root. */
  vaultDir: string;
  /** Subfolder for video sources, relative to the vault root. */
  notesSubdir?: string;
  /** ISO date (YYYY-MM-DD) stamped onto created/updated/ingested. */
  today: string;
  /** When true, nothing is written; the note is returned for preview instead. */
  dryRun?: boolean;
  /** When true, an existing note for the same video is overwritten. */
  force?: boolean;
}

interface UrlInput {
  url: string;
}

interface WriteSourceNoteInput {
  title: string;
  author: string;
  url: string;
  summary: string;
  keyIdeas: string[];
  quotes?: string[];
  connections?: string[];
  tags?: string[];
  published?: string;
}

/** Finds an existing note whose `url:` frontmatter points at the same video. */
async function findExistingNote(
  dir: string,
  videoId: string,
): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    // Missing folder simply means "no notes yet".
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const marker = `watch?v=${videoId}`;
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = `${dir}/${entry}`;
    try {
      const content = await readFile(filePath, "utf8");
      if (content.includes(marker)) return filePath;
    } catch {
      // Unreadable file is not fatal for the lookup — skip it.
    }
  }
  return undefined;
}

/**
 * Vault tools: an idempotent duplicate check and the single write of the
 * finished source note. The write tool completes the agent run on success.
 */
export function createVaultTools(options: VaultToolOptions) {
  const subdir = options.notesSubdir ?? VIDEO_NOTES_SUBDIR;
  const dir = videoNotesDir(options.vaultDir, subdir);

  const checkVaultForVideo = createTool({
    name: "check_vault_for_video",
    description:
      "Kontrollerar om valvet redan har en källnot för videon (matchar video-ID i " +
      "frontmatter). Anropa alltid detta först.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "YouTube-URL eller video-ID." } },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (input: UrlInput) => {
      try {
        const videoId = parseVideoId(input.url);
        const existing = await findExistingNote(dir, videoId);
        return existing ? { exists: true, path: existing } : { exists: false };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
  });

  const writeSourceNote = createTool({
    name: "write_source_note",
    description:
      "Skriver den färdiga källnoten som Markdown till valvet " +
      `(${subdir}). Anropas exakt en gång — avslutar körningen.`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Videons titel (från metadata, ändra ej)." },
        author: { type: "string", description: "Kanal/skapare (från metadata)." },
        url: { type: "string", description: "Kanonisk YouTube-URL." },
        summary: { type: "string", description: "Sammanfattning som börjar med [fakta]." },
        keyIdeas: {
          type: "array",
          items: { type: "string" },
          description: "Punkter med epistemisk markör.",
        },
        quotes: { type: "array", items: { type: "string" } },
        connections: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        published: { type: "string", description: "Publiceringsdatum (YYYY-MM-DD), valfritt." },
      },
      required: ["title", "author", "url", "summary", "keyIdeas"],
      additionalProperties: false,
    },
    lifecycle: { completesRun: true },
    execute: async (input: WriteSourceNoteInput) => {
      try {
        const videoId = parseVideoId(input.url);
        const fileName = sourceNoteFileName(input.title);
        const filePath = `${dir}/${fileName}`;

        const markdown = buildSourceNote({
          title: input.title,
          author: input.author,
          url: input.url,
          videoId,
          summary: input.summary,
          keyIdeas: input.keyIdeas ?? [],
          quotes: input.quotes ?? [],
          connections: input.connections ?? [],
          tags: input.tags ?? [],
          ingested: options.today,
          ...(input.published ? { published: input.published } : {}),
        });

        if (options.dryRun) {
          return { written: false, dryRun: true, path: filePath, preview: markdown };
        }

        if (!options.force) {
          const existing = await findExistingNote(dir, videoId);
          if (existing) {
            return {
              written: false,
              reason: "En not för videon finns redan (använd --force för att skriva över).",
              path: existing,
            };
          }
        }

        await mkdir(dir, { recursive: true });
        await writeFile(filePath, markdown, "utf8");
        return { written: true, path: filePath, bytes: Buffer.byteLength(markdown, "utf8") };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
  });

  return [checkVaultForVideo, writeSourceNote] as const;
}
