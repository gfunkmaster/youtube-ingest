/**
 * Reads the agent's message log to explain a run that produced no note.
 *
 * Exists because "the run completed" is not an explanation: a run can finish
 * cleanly having written nothing, and the user deserves the actual reason rather
 * than a status code.
 */
export interface ToolPartLike {
  type: string;
  toolName?: string;
  output?: unknown;
}

export interface MessageLike {
  content: readonly ToolPartLike[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Output of every `tool-result` for a given tool, oldest first. */
export function toolOutputs(
  messages: readonly MessageLike[],
  toolName: string,
): unknown[] {
  return messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool-result" && part.toolName === toolName)
    .map((part) => part.output);
}

/** Names of the tools that actually ran, in order, including repeats. */
export function toolCallNames(messages: readonly MessageLike[]): string[] {
  return messages
    .flatMap((message) => message.content)
    .filter(
      (part) => part.type === "tool-result" && typeof part.toolName === "string",
    )
    .map((part) => part.toolName as string);
}

/**
 * Why did this run produce no note? Checked in order of specificity, so the
 * most concrete explanation wins over the generic one.
 */
export function describeNoNote(
  messages: readonly MessageLike[],
  runStatus: string,
): string {
  const write = toolOutputs(messages, "write_source_note").at(-1);
  if (isRecord(write)) {
    if (typeof write.reason === "string") return write.reason;
    if (typeof write.error === "string") return `notverktyget felade: ${write.error}`;
  }

  const check = toolOutputs(messages, "check_vault_for_video").at(-1);
  if (isRecord(check) && check.exists === true) {
    const path = typeof check.path === "string" ? ` (${check.path})` : "";
    return `noten finns redan${path}`;
  }

  const transcript = toolOutputs(messages, "fetch_youtube_transcript").at(-1);
  if (isRecord(transcript) && typeof transcript.error === "string") {
    return `ingen transkription: ${transcript.error}`;
  }

  const calls = toolCallNames(messages);
  if (calls.length === 0) {
    return (
      `modellen anropade inga verktyg alls (körningen: ${runStatus}) — ` +
      "providern/modellen följde inte instruktionerna"
    );
  }

  return (
    `modellen avslutade utan att anropa write_source_note ` +
    `(anropade: ${calls.join(" → ")})`
  );
}
