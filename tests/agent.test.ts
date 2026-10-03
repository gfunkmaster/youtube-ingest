import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  runIngestAgent,
  type AgentModelLike,
  type AgentTools,
} from "../src/agent/run.js";
import { createVaultTools } from "../src/tools/vault.js";
import { createYoutubeTools } from "../src/tools/youtube.js";

const URL = "https://www.youtube.com/watch?v=45K3zHckCnQ";

type ModelEvent = { type: string } & Record<string, unknown>;

/**
 * A model that replays canned event batches, one batch per `stream()` call.
 * This exercises the real agent loop (tool execution, completion) with no
 * network and no API key.
 */
function scriptedModel(steps: ModelEvent[][]): AgentModelLike {
  let call = 0;
  const model = {
    stream: () => {
      const events = steps[call] ?? [];
      call += 1;
      return (async function* () {
        for (const event of events) yield event;
      })();
    },
  };
  return model as unknown as AgentModelLike;
}

const oembedFetch: typeof globalThis.fetch = async () =>
  new Response(
    JSON.stringify({ title: "Test Title", author_name: "Test Channel" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

function toolResultOutputs(
  messages: readonly {
    content: readonly { type: string; toolName?: string; output?: unknown }[];
  }[],
  toolName: string,
): unknown[] {
  return messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool-result" && part.toolName === toolName)
    .map((part) => part.output);
}

describe("runIngestAgent", () => {
  it("executes a tool call and completes the loop", async () => {
    const tools = [...createYoutubeTools({ fetch: oembedFetch })] as unknown as AgentTools;
    const model = scriptedModel([
      [
        {
          type: "tool-call-delta",
          toolCallId: "call_1",
          toolName: "fetch_youtube_metadata",
          input: { url: URL },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "Klart." },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const result = await runIngestAgent({
      model,
      systemPrompt: "test",
      tools,
      prompt: "go",
      maxIterations: 4,
    });

    expect(result.status).toBe("completed");
    expect(result.outputText).toContain("Klart.");

    const outputs = toolResultOutputs(result.messages, "fetch_youtube_metadata");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ title: "Test Title", author: "Test Channel" });
  });

  it("writes a note through the agent and ends on the completion tool", async () => {
    const dir = await mkdtemp(join(tmpdir(), "youtube-ingest-agent-"));

    try {
      const tools = [...createVaultTools({ vaultDir: dir, today: "2026-10-03" })] as unknown as AgentTools;
      const model = scriptedModel([
        [
          {
            type: "tool-call-delta",
            toolCallId: "write_1",
            toolName: "write_source_note",
            input: {
              title: "Från agenten",
              author: "Kanal",
              url: URL,
              summary: "[fakta] Sammanfattning.",
              keyIdeas: ["[tolkning] En idé."],
            },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text-delta", text: "Klart." },
          { type: "finish", reason: "stop" },
        ],
      ]);

      const result = await runIngestAgent({
        model,
        systemPrompt: "test",
        tools,
        prompt: "go",
        maxIterations: 4,
      });

      expect(result.status).toBe("completed");
      expect(toolResultOutputs(result.messages, "write_source_note")[0]).toMatchObject({
        written: true,
      });

      const content = await readFile(
        join(dir, "01-Raw/Videos", "Från agenten (video).md"),
        "utf8",
      );
      expect(content).toContain("## Sammanfattning");
      expect(content).toContain('status: raw');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
