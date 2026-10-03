import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildSourceHubNote, sourceHubFileName, type SourceHubEntry } from "./note.js";

/** Where source hubs live, matching the vault's existing convention. */
export const HUB_SUBDIR = "02-Wiki/Sources";

export interface WriteHubOptions {
  vaultDir: string;
  subdir?: string;
  title: string;
  url: string;
  ingested: string;
  entries: readonly SourceHubEntry[];
  dryRun?: boolean;
}

export interface WriteHubResult {
  path: string;
  bytes: number;
  written: boolean;
}

/**
 * Writes the playlist hub note. Deterministic: the hub is derived entirely from
 * run results, so no model is involved.
 */
export async function writeSourceHub(options: WriteHubOptions): Promise<WriteHubResult> {
  const dir = resolve(options.vaultDir, options.subdir ?? HUB_SUBDIR);
  const path = `${dir}/${sourceHubFileName(options.title)}`;

  const markdown = buildSourceHubNote({
    title: options.title,
    url: options.url,
    ingested: options.ingested,
    entries: options.entries,
  });

  const bytes = Buffer.byteLength(markdown, "utf8");
  if (options.dryRun) return { path, bytes, written: false };

  await mkdir(dir, { recursive: true });
  await writeFile(path, markdown, "utf8");
  return { path, bytes, written: true };
}
