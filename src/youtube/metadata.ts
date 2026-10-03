import { canonicalWatchUrl, parseVideoId } from "./video-id.js";

export interface VideoMetadata {
  videoId: string;
  title: string;
  author: string;
  url: string;
  thumbnailUrl?: string;
}

export interface MetadataDeps {
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

const OEMBED_ENDPOINT = "https://www.youtube.com/oembed";

/**
 * Fetches title, channel and thumbnail via YouTube's public oEmbed endpoint.
 * oEmbed needs no API key, which keeps the app credential-free for reads.
 */
export async function fetchVideoMetadata(
  input: string,
  deps: MetadataDeps = {},
): Promise<VideoMetadata> {
  const videoId = parseVideoId(input);
  const url = canonicalWatchUrl(videoId);
  const fetchFn = deps.fetch ?? globalThis.fetch;

  const response = await fetchFn(
    `${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}&format=json`,
    { headers: { accept: "application/json" } },
  );

  if (!response.ok) {
    throw new Error(
      `YouTube oEmbed svarade ${response.status} ${response.statusText} för ${videoId}`,
    );
  }

  const data = (await response.json()) as {
    title?: unknown;
    author_name?: unknown;
    thumbnail_url?: unknown;
  };

  const title = typeof data.title === "string" ? data.title : undefined;
  const author = typeof data.author_name === "string" ? data.author_name : undefined;
  if (!title || !author) {
    throw new Error(`oEmbed-svaret för ${videoId} saknade titel eller kanalnamn`);
  }

  const thumbnailUrl =
    typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined;

  return {
    videoId,
    title,
    author,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}
