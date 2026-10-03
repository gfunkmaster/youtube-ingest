import { describe, expect, it } from "vitest";

import { buildSourceNote, sourceNoteFileName } from "../src/vault/note.js";

const base = {
  title: 'I Spent $31,141 & 1,000 Hours "On" Claude Code',
  author: "Nick Saraev",
  url: "https://www.youtube.com/watch?v=45K3zHckCnQ",
  videoId: "45K3zHckCnQ",
  ingested: "2026-10-03",
  summary: "[fakta] Nick Saraev delar lärdomar efter 1 000 timmar i Claude Code.",
  keyIdeas: ["[tolkning] Lita inte på första resultatet.", "[fakta] Kör evals för att mäta."],
  quotes: ["Du kan inte lita på första resultatet"],
  connections: ["[[Evals (utvärdering av AI)]]"],
  tags: ["claude-code", "ai"],
  transcript: "Hej och välkomna. Idag pratar vi om Claude Code.",
};

describe("buildSourceNote", () => {
  it("emits a frontmatter block that matches the source template", () => {
    const note = buildSourceNote(base);
    const frontmatter = note.slice(0, note.indexOf("\n---", 4));

    expect(note.startsWith("---\n")).toBe(true);
    expect(frontmatter).toContain("type: source");
    expect(frontmatter).toContain('source_type: "video"');
    expect(frontmatter).toContain('author: "Nick Saraev"');
    expect(frontmatter).toContain("status: raw");
    expect(frontmatter).toContain('ingested: "2026-10-03"');
    expect(frontmatter).toContain('created: "2026-10-03"');
    expect(frontmatter).toContain('updated: "2026-10-03"');
    expect(frontmatter).toContain('tags: ["claude-code", "ai"]');
  });

  it("escapes double quotes inside YAML values instead of breaking the block", () => {
    const note = buildSourceNote(base);
    expect(note).toContain('title: "I Spent $31,141 & 1,000 Hours \\"On\\" Claude Code"');
  });

  it("includes every expected section", () => {
    const note = buildSourceNote(base);
    expect(note).toContain("# I Spent $31,141 & 1,000 Hours");
    for (const heading of [
      "## Sammanfattning",
      "## Nyckelidéer",
      "## Citat",
      "## Kopplingar",
      "## Transkript",
      "## Källa",
    ]) {
      expect(note).toContain(heading);
    }
    expect(note).toContain("- https://www.youtube.com/watch?v=45K3zHckCnQ");
  });

  it("omits optional sections when their data is empty", () => {
    const note = buildSourceNote({
      ...base,
      quotes: [],
      connections: [],
      transcript: "",
    });
    expect(note).not.toContain("## Citat");
    expect(note).not.toContain("## Kopplingar");
    expect(note).not.toContain("## Transkript");
  });

  it("warns visibly when the transcript was truncated", () => {
    const note = buildSourceNote({
      ...base,
      transcriptTruncated: true,
      transcriptChars: 120000,
    });

    expect(note).toContain("> [!warning] Transkriptet är kapat");
    expect(note).toMatch(/120\s000 tecken/);
    // Must be read BEFORE the claims it undermines.
    expect(note.indexOf("[!warning]")).toBeLessThan(note.indexOf("## Sammanfattning"));
  });

  it("does not warn when the transcript is complete", () => {
    const note = buildSourceNote({ ...base, transcriptTruncated: false });
    expect(note).not.toContain("[!warning]");
  });

  it("states the kept count against the full length when both are known", () => {
    const note = buildSourceNote({
      ...base,
      transcriptTruncated: true,
      transcriptChars: 120000,
      transcriptTotalChars: 350000,
    });
    expect(note).toMatch(/120\s000 av ~350\s000 tecken/);
  });

  it("still warns when no character count is given", () => {
    const note = buildSourceNote({ ...base, transcriptTruncated: true });
    expect(note).toContain("> [!warning] Transkriptet är kapat");
    expect(note).toContain("Transkriptet kapades.");
  });

  it("writes an empty published field when the date is unknown", () => {
    expect(buildSourceNote(base)).toContain('published: ""');
  });

  it("includes published when provided", () => {
    expect(buildSourceNote({ ...base, published: "2025-08-01" })).toContain(
      'published: "2025-08-01"',
    );
  });
});

describe("sourceNoteFileName", () => {
  it("appends the (video) suffix used in 01-Raw/Videos", () => {
    expect(sourceNoteFileName("Hello World")).toBe("Hello World (video).md");
  });

  it("removes path- and URL-unsafe characters", () => {
    const name = sourceNoteFileName('A/B: "Test"? #1 | <odd>');
    expect(name.endsWith(" (video).md")).toBe(true);
    expect(name).not.toMatch(/[\\/:*?"<>|#^[\]]/);
  });

  it("keeps normal punctuation such as commas, ampersands and dots", () => {
    expect(sourceNoteFileName("I Spent $31,141 & 1,000 Hours")).toBe(
      "I Spent $31,141 & 1,000 Hours (video).md",
    );
  });

  it("falls back to a default base name for a blank title", () => {
    expect(sourceNoteFileName("   ")).toBe("video (video).md");
  });
});
