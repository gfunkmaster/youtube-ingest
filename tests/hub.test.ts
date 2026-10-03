import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSourceHub } from "../src/vault/hub.js";
import { buildSourceHubNote, sourceHubFileName } from "../src/vault/note.js";

const URL = "https://www.youtube.com/playlist?list=PLSbQllRagIuQWckVcfszya8Zv8HGheNlc";

const input = {
  title: "Claude Code",
  url: URL,
  ingested: "2026-10-03",
  entries: [
    { title: "Course part 1", videoId: "QoQBzR1NIqI", noteName: "Course part 1 (video)" },
    { title: "Older clip", videoId: "zbCxi7CjiF0", skippedReason: "Ingen transkription hämtades." },
  ],
};

describe("buildSourceHubNote", () => {
  it("is a source note typed as a playlist", () => {
    const note = buildSourceHubNote(input);
    expect(note).toContain("type: source");
    expect(note).toContain('source_type: "playlist"');
    expect(note).toContain(`url: "${URL}"`);
  });

  it("links written notes and names why others were skipped", () => {
    const note = buildSourceHubNote(input);
    expect(note).toContain("[[Course part 1 (video)]]");
    expect(note).toContain("*(ingen not: Ingen transkription hämtades.)*");
  });

  it("summarises how many notes were written", () => {
    const note = buildSourceHubNote(input);
    expect(note).toContain("Spellista med 2 videor — 1 källnoter skrivna, 1 hoppade över.");
  });

  it("says so plainly when everything worked", () => {
    const note = buildSourceHubNote({
      ...input,
      entries: [input.entries[0]!],
    });
    expect(note).toContain("1 källnoter skrivna.");
    expect(note).not.toContain("hoppade över");
  });
});

describe("sourceHubFileName", () => {
  it("has no (video) suffix and strips unsafe characters", () => {
    expect(sourceHubFileName("Claude Code")).toBe("Claude Code.md");
    expect(sourceHubFileName("A/B: C?")).toBe("A-B- C-.md");
    expect(sourceHubFileName("   ")).toBe("spellista.md");
  });
});

describe("writeSourceHub", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "youtube-ingest-hub-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes into 02-Wiki/Sources, matching the vault's hub convention", async () => {
    const result = await writeSourceHub({ vaultDir: dir, ...input });

    expect(result.written).toBe(true);
    expect(result.path).toBe(join(dir, "02-Wiki/Sources", "Claude Code.md"));

    const content = await readFile(result.path, "utf8");
    expect(content).toContain("# Claude Code");
    expect(content).toContain("## Videor");
  });

  it("writes nothing in dry-run mode", async () => {
    const result = await writeSourceHub({ vaultDir: dir, ...input, dryRun: true });
    expect(result.written).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
    await expect(readFile(result.path, "utf8")).rejects.toThrow();
  });
});
