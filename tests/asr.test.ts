import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  markdownPathFromEvents,
  parseRenderedMarkdown,
  transcribeWithAsr,
  type AsrRunResult,
} from "../src/youtube/asr.js";

const URL = "https://www.youtube.com/watch?v=45K3zHckCnQ";

const RENDERED = `---
source_url: "https://www.youtube.com/watch?v=45K3zHckCnQ"
extractor: "Youtube"
id: "45K3zHckCnQ"
title: "Test Title"
uploader: "Test Channel"
upload_date: "2026-01-02"
duration: "01:02"
duration_seconds: 62
language: "sv"
model: "mlx-community/whisper-large-v3-turbo"
audio_sha256: "abc"
transcribed_at: "2026-10-29T10:00:00Z"
---

# Test Title

https://www.youtube.com/watch?v=45K3zHckCnQ — uploaded by Test Channel, 2026-01-02

- **00:00** Första fönstret med text.
- **00:46** Andra fönstret.
`;

/** Stub runner that behaves like transcribe-url writing one markdown file. */
function stubRun(markdown: string, code = 0) {
  const calls: { file: string; args: readonly string[]; timeoutMs: number }[] = [];
  const run = async (
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<AsrRunResult> => {
    calls.push({ file, args, timeoutMs });
    if (code !== 0) {
      return {
        code,
        stdout: `${JSON.stringify({ event: "error", message: "model missing" })}\n`,
        stderr: "",
      };
    }
    const outdir = args[args.indexOf("-o") + 1];
    if (outdir === undefined) throw new Error("stub: no -o in args");
    const path = join(outdir, "video.md");
    await writeFile(path, markdown, "utf8");
    return {
      code: 0,
      stdout: `${JSON.stringify({ event: "wrote", path, format: "rendered" })}\n`,
      stderr: "",
    };
  };
  return { run, calls };
}

describe("parseRenderedMarkdown", () => {
  it("reads the language and keeps the anchored lines", () => {
    const parsed = parseRenderedMarkdown(RENDERED);
    expect(parsed.language).toBe("sv");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toContain("**00:00**");
    expect(parsed.lines[1]).toContain("Andra fönstret");
  });

  it("survives markdown without frontmatter", () => {
    const parsed = parseRenderedMarkdown("- **00:00** bara text\n");
    expect(parsed.language).toBe("");
    expect(parsed.lines).toEqual(["- **00:00** bara text"]);
  });
});

describe("markdownPathFromEvents", () => {
  it("finds the rendered markdown among mixed output", () => {
    const stdout = [
      "not json at all",
      JSON.stringify({ event: "start" }),
      JSON.stringify({ event: "wrote", path: "/tmp/x.srt", format: "srt" }),
      JSON.stringify({ event: "wrote", path: "/tmp/x.md", format: "rendered" }),
    ].join("\n");
    expect(markdownPathFromEvents(stdout)).toBe("/tmp/x.md");
  });

  it("returns undefined when nothing was written", () => {
    expect(markdownPathFromEvents("")).toBeUndefined();
  });
});

describe("transcribeWithAsr", () => {
  it("returns anchored text with the detected language", async () => {
    const { run, calls } = stubRun(RENDERED);
    const result = await transcribeWithAsr(URL, { run, lang: "sv" });

    expect(result).toMatchObject({
      videoId: "45K3zHckCnQ",
      language: "sv",
      segmentCount: 2,
      truncated: false,
      source: "asr",
    });
    expect(result.text).toContain("- **00:00** Första fönstret");
    expect(result.totalChars).toBe(result.text.length);
    expect(calls[0]?.args).toContain("--json-events");
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(["-f", "md", "--flat", "-l", "sv", URL]),
    );
  });

  it("caps the text and flags truncation", async () => {
    const { run } = stubRun(RENDERED);
    const result = await transcribeWithAsr(URL, { run, maxChars: 20 });
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(20);
    expect(result.totalChars).toBeGreaterThan(20);
  });

  it("reports the CLI's error event when the run fails", async () => {
    const { run } = stubRun("", 1);
    await expect(transcribeWithAsr(URL, { run })).rejects.toThrow(/model missing/);
  });

  it("fails when the CLI wrote no markdown", async () => {
    const run = async (): Promise<AsrRunResult> => ({ code: 0, stdout: "", stderr: "" });
    await expect(transcribeWithAsr(URL, { run })).rejects.toThrow(/ingen markdown/);
  });

  it("fails when the transcript is empty (no speech)", async () => {
    const empty = RENDERED.split("- **00:00**")[0] ?? "";
    const { run } = stubRun(empty);
    await expect(transcribeWithAsr(URL, { run })).rejects.toThrow(/inget tal/);
  });

  it("honours a custom binary name", async () => {
    const { run, calls } = stubRun(RENDERED);
    await transcribeWithAsr(URL, { run, bin: "/opt/bin/transcribe-url" });
    expect(calls[0]?.file).toBe("/opt/bin/transcribe-url");
  });
});
