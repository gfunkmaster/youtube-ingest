import { describe, expect, it, vi } from "vitest";

import {
  fetchPlaylistItems,
  YtDlpMissingError,
  type PlaylistRunner,
  type PlaylistRunResult,
} from "../src/youtube/playlist.js";

const LIST = "PLSbQllRagIuQWckVcfszya8Zv8HGheNlc";
const URL = `https://www.youtube.com/playlist?list=${LIST}`;

function runner(result: Partial<PlaylistRunResult>) {
  return vi.fn<PlaylistRunner>(async () => ({ stdout: "", stderr: "", code: 0, ...result }));
}

describe("fetchPlaylistItems", () => {
  it("parses title and id pairs, de-duplicating ids", async () => {
    const run = runner({
      stdout: [
        "Claude Code|QoQBzR1NIqI",
        "Claude Code|zbCxi7CjiF0",
        "Claude Code|QoQBzR1NIqI", // duplicate
        "",
      ].join("\n"),
    });

    const items = await fetchPlaylistItems(URL, { run });

    expect(items).toEqual([
      { videoId: "QoQBzR1NIqI", playlistTitle: "Claude Code" },
      { videoId: "zbCxi7CjiF0", playlistTitle: "Claude Code" },
    ]);
  });

  it("keeps a title that itself contains a pipe", async () => {
    const run = runner({ stdout: "A | B | C|QoQBzR1NIqI" });
    const items = await fetchPlaylistItems(URL, { run });
    expect(items[0]?.playlistTitle).toBe("A | B | C");
  });

  it("passes the cap to yt-dlp instead of filtering afterwards", async () => {
    const run = runner({ stdout: "T|QoQBzR1NIqI" });
    await fetchPlaylistItems(URL, { run, limit: 3 });

    const args = run.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--playlist-end");
    expect(args[args.indexOf("--playlist-end") + 1]).toBe("3");
    expect(args).toContain("--flat-playlist");
    // Never download.
    expect(args).not.toContain("-o");
  });

  it("skips lines that are not video ids", async () => {
    const run = runner({
      stdout: ["metadata|not-an-id", "T|QoQBzR1NIqI", "garbage"].join("\n"),
    });
    const items = await fetchPlaylistItems(URL, { run });
    expect(items.map((item) => item.videoId)).toEqual(["QoQBzR1NIqI"]);
  });

  it("reports a missing yt-dlp with an install hint", async () => {
    const run = vi.fn<PlaylistRunner>(async () => {
      throw new YtDlpMissingError("yt-dlp");
    });
    await expect(fetchPlaylistItems(URL, { run })).rejects.toThrow(/brew install yt-dlp/);
  });

  it("surfaces a non-zero exit with yt-dlp's own stderr", async () => {
    const run = runner({ code: 1, stderr: "ERROR: playlist does not exist\nmore" });
    await expect(fetchPlaylistItems(URL, { run })).rejects.toThrow(/kod 1.*does not exist/s);
  });

  it("rejects a url without a playlist id", async () => {
    await expect(
      fetchPlaylistItems("https://youtu.be/45K3zHckCnQ", { run: runner({}) }),
    ).rejects.toThrow(/spelliste-ID/);
  });

  it("rejects a nonsense cap before shelling out", async () => {
    const run = runner({});
    await expect(fetchPlaylistItems(URL, { run, limit: 0 })).rejects.toThrow(/max-videos/);
    expect(run).not.toHaveBeenCalled();
  });
});
