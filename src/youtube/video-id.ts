/**
 * Extracts a YouTube video id from a URL or validates a bare 11-character id.
 *
 * Deliberately more tolerant than the `youtube-transcript` package's internal
 * regex, which does not understand `/shorts/`, `/live/` or `music.youtube.com`.
 * Because `parseVideoId` runs first and only the bare id is ever handed to the
 * transcript library, those URL shapes work here even though the library's own
 * parser would reject them.
 */
const BARE_ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_PREFIXES = new Set(["shorts", "live", "embed", "v"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

export class InvalidVideoIdError extends Error {
  constructor(input: string) {
    super(`Hittade inget YouTube-video-ID i: ${input}`);
    this.name = "InvalidVideoIdError";
  }
}

function hostName(host: string): string {
  return host.replace(/^www\.|^m\./, "");
}

/**
 * @param input A YouTube URL (watch, youtu.be, shorts, live, embed, music) or a
 *   bare 11-character video id.
 * @returns The 11-character video id.
 * @throws InvalidVideoIdError when no id can be found.
 */
export function parseVideoId(input: string): string {
  const value = input.trim();
  if (BARE_ID.test(value)) return value;

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const host = hostName(url.hostname);

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id && BARE_ID.test(id)) return id;
    }

    if (YOUTUBE_HOSTS.has(host)) {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery && BARE_ID.test(fromQuery)) return fromQuery;

      const parts = url.pathname.split("/").filter(Boolean);
      const [prefix, candidate] = parts;
      if (prefix && PATH_PREFIXES.has(prefix) && candidate && BARE_ID.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Not a parseable URL — fall through to the regex probes below.
  }

  const queryMatch = /[?&]v=([A-Za-z0-9_-]{11})/.exec(value);
  if (queryMatch?.[1]) return queryMatch[1];

  const shortMatch = /youtu\.be\/([A-Za-z0-9_-]{11})/i.exec(value);
  if (shortMatch?.[1]) return shortMatch[1];

  throw new InvalidVideoIdError(input);
}

/** Canonical watch URL for a video id — used for oEmbed and the note's `url`. */
export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
