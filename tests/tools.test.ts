import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createVaultTools } from "../src/tools/vault.js";
import { createYoutubeTools } from "../src/tools/youtube.js";

const URL = "https://www.youtube.com/watch?v=45K3zHckCnQ";
const CONTEXT = { agentId: "test", iteration: 1 };

const oembedFetch: typeof globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      title: "Test Title",
      author_name: "Test Channel",
      thumbnail_url: "https://i.ytimg.com/vi/45K3zHckCnQ/hqdefault.jpg",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

type FetchInput = Parameters<typeof globalThis.fetch>[0];

/** Extracts the request URL without relying on `instanceof`. */
function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  return typeof (input as Request).url === "string" ? (input as Request).url : String(input);
}

/** Fakes the two-step InnerTube + timedtext flow used by the transcript lib. */
const transcriptFetch: typeof globalThis.fetch = async (input) => {
  const url = requestUrl(input);

  if (url.includes("/youtubei/v1/player")) {
    return new Response(
      JSON.stringify({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://www.youtube.com/api/timedtext?v=45K3zHckCnQ&lang=en",
                languageCode: "en",
              },
            ],
          },
        },
      }),
      { status: 200 },
    );
  }

  return new Response(
    '<transcript><text start="0" dur="2">Hello world from the transcript</text></transcript>',
    { status: 200 },
  );
};

describe("createYoutubeTools", () => {
  it("returns metadata from the injected fetch", async () => {
    const [metadataTool] = createYoutubeTools({ fetch: oembedFetch });
    const result = await metadataTool.execute({ url: URL }, CONTEXT);

    expect(result).toMatchObject({
      videoId: "45K3zHckCnQ",
      title: "Test Title",
      author: "Test Channel",
    });
  });

  it("returns the transcript text from the injected fetch", async () => {
    const [, transcriptTool] = createYoutubeTools({ fetch: transcriptFetch });
    const result = await transcriptTool.execute({ url: URL }, CONTEXT);

    expect(result).toMatchObject({
      videoId: "45K3zHckCnQ",
      language: "en",
      segmentCount: 1,
    });
    expect((result as { text: string }).text).toContain("Hello world from the transcript");
  });

  it("returns a structured error instead of throwing on a bad url", async () => {
    const [metadataTool, transcriptTool] = createYoutubeTools();

    expect(await metadataTool.execute({ url: "not-a-url" }, CONTEXT)).toEqual({
      error: expect.stringContaining("video-ID"),
    });
    expect(await transcriptTool.execute({ url: "not-a-url" }, CONTEXT)).toEqual({
      error: expect.stringContaining("video-ID"),
    });
  });
});

describe("createVaultTools", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "youtube-ingest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const noteInput = {
    title: "Test Title",
    author: "Test Channel",
    url: URL,
    summary: "[fakta] Sammanfattning.",
    keyIdeas: ["[tolkning] En idé."],
  };

  it("writes the note, then reports it as already existing", async () => {
    const [checkTool, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03" });

    expect(await checkTool.execute({ url: URL }, CONTEXT)).toEqual({ exists: false });

    const write = await writeTool.execute(noteInput, CONTEXT);
    expect(write).toMatchObject({ written: true });

    const filePath = join(dir, "01-Raw/Videos", "Test Title (video).md");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('status: raw');
    expect(content).toContain(URL);

    expect(await checkTool.execute({ url: URL }, CONTEXT)).toMatchObject({ exists: true });
  });

  it("does not overwrite an existing note unless force is set", async () => {
    const [, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03" });
    await writeTool.execute(noteInput, CONTEXT);

    const second = await writeTool.execute({ ...noteInput, summary: "[fakta] Ändrad." }, CONTEXT);
    expect(second).toMatchObject({ written: false });
    expect((second as { reason: string }).reason).toContain("finns redan");
  });

  it("writes nothing in dry-run mode and returns a preview", async () => {
    const [, writeTool] = createVaultTools({
      vaultDir: dir,
      today: "2026-10-03",
      dryRun: true,
    });

    const result = await writeTool.execute(noteInput, CONTEXT);
    expect(result).toMatchObject({ written: false, dryRun: true });
    expect((result as { preview: string }).preview).toContain("## Sammanfattning");

    await expect(
      readFile(join(dir, "01-Raw/Videos", "Test Title (video).md"), "utf8"),
    ).rejects.toThrow();
  });
});
