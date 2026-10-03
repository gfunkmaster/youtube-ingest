import { Agent } from "@cline/sdk";

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
export function runIngestAgent(options: RunIngestAgentOptions): ReturnType<Agent["run"]> {
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

  return agent.run(options.prompt);
}
