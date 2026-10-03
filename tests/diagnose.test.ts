import { describe, expect, it } from "vitest";

import {
  describeNoNote,
  toolCallNames,
  toolOutputs,
  type MessageLike,
} from "../src/agent/diagnose.js";

function messages(...parts: (readonly [string, unknown])[]): MessageLike[] {
  return [
    {
      content: parts.map(([toolName, output]) => ({
        type: "tool-result",
        toolName,
        output,
      })),
    },
  ];
}

describe("toolOutputs", () => {
  it("returns only the named tool's outputs", () => {
    const log = messages(["a", { x: 1 }], ["b", { y: 2 }], ["a", { x: 3 }]);
    expect(toolOutputs(log, "a")).toEqual([{ x: 1 }, { x: 3 }]);
    expect(toolOutputs(log, "missing")).toEqual([]);
  });
});

describe("toolCallNames", () => {
  it("lists executed tools in order", () => {
    const log = messages(["a", {}], ["b", {}]);
    expect(toolCallNames(log)).toEqual(["a", "b"]);
  });
});

describe("describeNoNote", () => {
  it("prefers the note tool's own refusal reason", () => {
    const log = messages([
      "write_source_note",
      { written: false, reason: "Ingen transkription hämtades för videon." },
    ]);
    expect(describeNoNote(log, "completed")).toBe(
      "Ingen transkription hämtades för videon.",
    );
  });

  it("reports an error from the note tool", () => {
    const log = messages(["write_source_note", { error: "kaboom" }]);
    expect(describeNoNote(log, "completed")).toBe("notverktyget felade: kaboom");
  });

  it("recognises an already-existing note", () => {
    const log = messages(
      ["check_vault_for_video", { exists: true, path: "/v/01-Raw/Videos/x.md" }],
      ["fetch_youtube_metadata", { title: "t" }],
    );
    expect(describeNoNote(log, "completed")).toContain("noten finns redan");
    expect(describeNoNote(log, "completed")).toContain("/v/01-Raw/Videos/x.md");
  });

  it("surfaces a failed transcript fetch", () => {
    const log = messages(
      ["check_vault_for_video", { exists: false }],
      ["fetch_youtube_transcript", { error: "Ingen transkription hittades" }],
    );
    expect(describeNoNote(log, "completed")).toContain("ingen transkription");
  });

  it("says so when the model never called a tool at all", () => {
    expect(describeNoNote([], "completed")).toContain("inga verktyg alls");
    expect(describeNoNote([], "completed")).toContain("följde inte instruktionerna");
  });

  it("lists what the model did call when it skipped the note tool", () => {
    const log = messages(
      ["check_vault_for_video", { exists: false }],
      ["fetch_youtube_metadata", { title: "t" }],
      ["fetch_youtube_transcript", { text: "..." }],
    );
    const reason = describeNoNote(log, "completed");
    expect(reason).toContain("utan att anropa write_source_note");
    expect(reason).toContain("check_vault_for_video → fetch_youtube_metadata → fetch_youtube_transcript");
  });

  it("never returns a bare run status", () => {
    const log = messages(["fetch_youtube_metadata", { title: "t" }]);
    expect(describeNoNote(log, "completed")).not.toBe("status completed");
  });
});
