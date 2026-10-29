import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIngestSession } from "../src/session.js";
import { createVaultTools } from "../src/tools/vault.js";
import { createYoutubeTools } from "../src/tools/youtube.js";

const URL = "https://www.youtube.com/watch?v=45K3zHckCnQ";
const CONTEXT = { agentId: "test", iteration: 1 };

// Keep the ASR fallback off for the existing tests: they must never spawn the
// CLI. The ASR cases below opt in with `asr: { enabled: true, run: stub }`.
process.env.YOUTUBE_INGEST_ASR = "0";

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

  it("attaches the transcript from the session, never from the model", async () => {
    const session = createIngestSession();
    session.transcript = {
      videoId: "45K3zHckCnQ",
      language: "en",
      text: "Hello from the source.",
      truncated: true,
      chars: 21,
      totalChars: 350000,
    };
    const [, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03", session });

    await writeTool.execute(noteInput, CONTEXT);

    const content = await readFile(
      join(dir, "01-Raw/Videos", "Test Title (video).md"),
      "utf8",
    );
    expect(content).toContain("## Transkript");
    expect(content).toContain("Hello from the source.");
    // The warning uses the SESSION's numbers, not anything the model said.
    expect(content).toContain("> [!warning] Transkriptet är kapat");
    expect(content).toMatch(/21 av ~350\s000 tecken/);
  });

  it("refuses to write when the session holds another video's transcript", async () => {
    const session = createIngestSession();
    session.transcript = {
      videoId: "ZZZZZZZZZZZ",
      language: "en",
      text: "WRONG VIDEO SOURCE",
      truncated: false,
      chars: 18,
      totalChars: 18,
    };
    const [, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03", session });

    const result = await writeTool.execute(noteInput, CONTEXT);

    expect(result).toMatchObject({ written: false });
    expect((result as { reason: string }).reason).toContain("Ingen transkription");
    await expect(
      readFile(join(dir, "01-Raw/Videos", "Test Title (video).md"), "utf8"),
    ).rejects.toThrow();
  });

  it("refuses to write a source note when no transcript was fetched", async () => {
    const session = createIngestSession();
    const [, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03", session });

    const result = await writeTool.execute(noteInput, CONTEXT);

    expect(result).toMatchObject({ written: false });
    expect((result as { reason: string }).reason).toMatch(/påhittad/);
  });

  it("still writes without a session (no transcript guard applies)", async () => {
    const [, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03" });
    const result = await writeTool.execute(noteInput, CONTEXT);
    expect(result).toMatchObject({ written: true });
  });

  it("omits the transcript when includeTranscript is false", async () => {
    const session = createIngestSession();
    session.transcript = {
      videoId: "45K3zHckCnQ",
      language: "en",
      text: "Some source text.",
      truncated: false,
      chars: 16,
      totalChars: 16,
    };
    const [, writeTool] = createVaultTools({
      vaultDir: dir,
      today: "2026-10-03",
      session,
      includeTranscript: false,
    });

    await writeTool.execute(noteInput, CONTEXT);

    const content = await readFile(
      join(dir, "01-Raw/Videos", "Test Title (video).md"),
      "utf8",
    );
    expect(content).not.toContain("## Transkript");
    expect(content).not.toContain("Some source text.");
  });

  it("carries the truncation flag through to the written note", async () => {
    const [, writeTool] = createVaultTools({ vaultDir: dir, today: "2026-10-03" });

    await writeTool.execute(
      { ...noteInput, transcriptTruncated: true, transcriptChars: 120000 },
      CONTEXT,
    );

    const content = await readFile(
      join(dir, "01-Raw/Videos", "Test Title (video).md"),
      "utf8",
    );
    expect(content).toContain("> [!warning] Transkriptet är kapat");
    expect(content).toMatch(/120\s000 tecken/);
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

describe("ASR fallback", () => {
  /** Player response with no caption tracks: the library throws. */
  const noCaptionsFetch: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify({ captions: {} }), { status: 200 });

  function stubAsr(text = "- **00:00** Lokal ASR-text.") {
    const calls: string[][] = [];
    const run = async (file: string, args: readonly string[]) => {
      calls.push([file, ...args]);
      const outdir = args[args.indexOf("-o") + 1];
      if (outdir === undefined) throw new Error("stub: no -o");
      const path = join(outdir, "video.md");
      await writeFile(path, `---\nlanguage: "sv"\n---\n\n# t\n\n${text}\n`, "utf8");
      return {
        code: 0,
        stdout: `${JSON.stringify({ event: "wrote", path, format: "rendered" })}\n`,
        stderr: "",
      };
    };
    return { run, calls };
  }

  it("falls back to local ASR when the video has no captions", async () => {
    const session = createIngestSession();
    const asr = stubAsr();
    const [, transcriptTool] = createYoutubeTools({
      fetch: noCaptionsFetch,
      session,
      asr: { enabled: true, run: asr.run },
    });

    const result = await transcriptTool.execute({ url: URL }, CONTEXT);

    expect(result).toMatchObject({ source: "asr", language: "sv", segmentCount: 1 });
    expect((result as { text: string }).text).toContain("Lokal ASR-text");
    expect(session.transcript?.source).toBe("asr");
    expect(session.transcript?.text).toContain("- **00:00**");
  });

  it("prefers captions when a track exists and records that", async () => {
    const session = createIngestSession();
    const asr = stubAsr();
    const [, transcriptTool] = createYoutubeTools({
      fetch: transcriptFetch,
      session,
      asr: { enabled: true, run: asr.run },
    });

    const result = await transcriptTool.execute({ url: URL }, CONTEXT);

    expect(result).toMatchObject({ source: "captions" });
    expect(asr.calls).toHaveLength(0);
    expect(session.transcript?.source).toBe("captions");
  });

  it("can be forced to ASR without reading captions at all", async () => {
    let fetched = 0;
    const countingFetch: typeof globalThis.fetch = async (input) => {
      fetched += 1;
      return transcriptFetch(input);
    };
    const asr = stubAsr();
    const [, transcriptTool] = createYoutubeTools({
      fetch: countingFetch,
      asr: { enabled: true, force: true, run: asr.run },
    });

    const result = await transcriptTool.execute({ url: URL }, CONTEXT);

    expect(result).toMatchObject({ source: "asr" });
    expect(fetched).toBe(0);
    expect(asr.calls).toHaveLength(1);
  });

  it("surfaces the caption error when the fallback is disabled", async () => {
    const [, transcriptTool] = createYoutubeTools({
      fetch: noCaptionsFetch,
      asr: { enabled: false },
    });

    const result = await transcriptTool.execute({ url: URL }, CONTEXT);

    expect(result).toEqual({ error: expect.stringContaining("transkription") });
  });
});

