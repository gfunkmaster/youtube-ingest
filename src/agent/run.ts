import { Agent } from "@cline/sdk";

import { toolOutputs } from "./diagnose.js";

/** Types derived from the SDK's Agent constructor — no invented shapes. */
type AgentConfig = ConstructorParameters<typeof Agent>[0];
export type AgentTools = NonNullable<AgentConfig["tools"]>;

type ModelBackedConfig = Extract<AgentConfig, { model: unknown }>;
/** A pre-built model, e.g. from `Llms.createGateway().createAgentModel(...)`. */
export type AgentModelLike = ModelBackedConfig["model"];

/** The subset of streamed events this app consumes. */
export interface AgentStreamEvent {
  type: string;
  text?: string;
}

export interface RunIngestBaseOptions {
  systemPrompt: string;
  tools: AgentTools;
  prompt: string;
  maxIterations?: number;
  /** Called for every streamed assistant text delta. */
  onText?: (delta: string) => void;
  /**
   * If the run ends without this tool ever being called, nudge the model once.
   *
   * Weaker models sometimes answer in prose and finish without calling the tool
   * that does the work — the run says "completed" but nothing happened. Retrying
   * the turn is cheaper and more model-agnostic than tuning the prompt.
   */
  requiredTool?: string;
}

/**
 * Either a provider/model pair (the normal CLI path) or a pre-built `model`
 * (used when embedding the agent, e.g. in tests).
 */
export type RunIngestAgentOptions = RunIngestBaseOptions &
  (
    | { model: AgentModelLike; providerId?: never; modelId?: never; apiKey?: never }
    | { model?: never; providerId: string; modelId: string; apiKey?: string }
  );

/**
 * Builds the SDK Agent for a single ingest run and executes it.
 * Text is streamed via `subscribe()`; the final answer is `result.outputText`.
 */
export async function runIngestAgent(
  options: RunIngestAgentOptions,
): Promise<Awaited<ReturnType<Agent["run"]>>> {
  const modelConfig = options.model
    ? { model: options.model }
    : {
        providerId: options.providerId,
        modelId: options.modelId,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      };

  const agent = new Agent({
    ...modelConfig,
    systemPrompt: options.systemPrompt,
    tools: options.tools,
    maxIterations: options.maxIterations ?? 12,
  });

  const onText = options.onText;
  if (onText) {
    agent.subscribe((event: AgentStreamEvent) => {
      if (event.type === "assistant-text-delta" && typeof event.text === "string") {
        onText(event.text);
      }
    });
  }

  const result = await agent.run(options.prompt);

  const required = options.requiredTool;
  if (required && toolOutputs(result.messages, required).length === 0) {
    return agent.continue(
      `Du avslutade utan att anropa ${required}. Anropa det nu — det är själva ` +
        "uppgiften. Avsluta inte med en sammanfattning i text i stället.",
    );
  }

  return result;
}
