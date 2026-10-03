import { describe, expect, it } from "vitest";

import { buildSystemPrompt, buildUserPrompt } from "../src/prompts.js";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt({ notesSubdir: "01-Raw/Videos", today: "2026-10-03" });

  it("names every tool the agent is expected to call", () => {
    for (const tool of [
      "check_vault_for_video",
      "fetch_youtube_metadata",
      "fetch_youtube_transcript",
      "write_source_note",
    ]) {
      expect(prompt).toContain(tool);
    }
  });

  it("requires the epistemic markers", () => {
    for (const marker of ["[fakta]", "[tolkning]", "[antagande]", "[osäkerhet]"]) {
      expect(prompt).toContain(marker);
    }
  });

  it("requires the truncation flag to be forwarded", () => {
    expect(prompt).toContain("transcriptTruncated");
    expect(prompt).toMatch(/OBLIGATORISKT/);
  });

  it("interpolates the target folder and date", () => {
    expect(prompt).toContain("01-Raw/Videos");
    expect(prompt).toContain("2026-10-03");
  });
});

describe("buildUserPrompt", () => {
  it("includes the url", () => {
    expect(buildUserPrompt("https://youtu.be/abc")).toContain("https://youtu.be/abc");
  });
});
