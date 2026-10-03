import { execFile } from "node:child_process";

import { playlistIdOf } from "./video-id.js";

export const DEFAULT_YTDLP_BIN = "yt-dlp";
/** Deliberately small: a mistyped playlist URL must not spend unbounded money. */
export const DEFAULT_MAX_VIDEOS = 10;

export interface PlaylistItem {
  videoId: string;
  /** Playlist name; yt-dlp repeats it on every line. */
  playlistTitle?: string;
}

export interface PlaylistRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Injectable so tests never shell out. */
export type PlaylistRunner = (bin: string, args: string[]) => Promise<PlaylistRunResult>;

export interface PlaylistOptions {
  /** Hard cap on videos to enumerate. */
  limit?: number;
  /** yt-dlp binary name or path. */
  bin?: string;
  /** Injectable runner (tests). */
  run?: PlaylistRunner;
}

export class YtDlpMissingError extends Error {
  constructor(bin: string) {
    super(
      `Hittade inte "${bin}". Installera den med: brew install yt-dlp\n` +
        "(spellistor kan inte räknas upp utan den).",
    );
    this.name = "YtDlpMissingError";
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function defaultRunner(bin: string, args: string[]): Promise<PlaylistRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new YtDlpMissingError(bin));
          return;
        }
        if (typeof code === "number") {
          resolve({ stdout, stderr, code });
          return;
        }
        reject(error);
      },
    );
  });
}

/**
 * Lists the videos of a playlist via `yt-dlp --flat-playlist`, which downloads
 * nothing. Chosen over page scraping: YouTube serves playlist items client-side
 * and consent-walls the HTML (verified), and over the Data API, which would add
 * a second credential for a personal tool.
 */
export async function fetchPlaylistItems(
  playlistUrl: string,
  options: PlaylistOptions = {},
): Promise<PlaylistItem[]> {
  const bin = options.bin ?? DEFAULT_YTDLP_BIN;
  const run = options.run ?? defaultRunner;
  const limit = options.limit ?? DEFAULT_MAX_VIDEOS;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--max-videos måste vara ett positivt heltal (fick ${limit})`);
  }

  if (!playlistIdOf(playlistUrl)) {
    throw new Error(`Hittade inget spelliste-ID (?list=...) i: ${playlistUrl}`);
  }

  const args = [
    "--flat-playlist",
    "--no-warnings",
    "--playlist-end",
    String(limit),
    "--print",
    "%(playlist_title)s|%(id)s",
    playlistUrl,
  ];

  const { stdout, stderr, code } = await run(bin, args);
  if (code !== 0) {
    const tail = stderr.trim().split("\n").slice(-3).join(" ");
    throw new Error(`yt-dlp misslyckades (kod ${code}): ${tail}`);
  }

  const items: PlaylistItem[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // lastIndexOf: a playlist title may itself contain a pipe.
    const sep = trimmed.lastIndexOf("|");
    if (sep === -1) continue;

    const title = trimmed.slice(0, sep).trim();
    const videoId = trimmed.slice(sep + 1).trim();
    if (!VIDEO_ID.test(videoId) || seen.has(videoId)) continue;

    seen.add(videoId);
    items.push({ videoId, ...(title ? { playlistTitle: title } : {}) });
  }

  return items;
}
