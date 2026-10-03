/** Turns anything thrown into a readable message (never throws itself). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/** Collapses all whitespace runs into single spaces and trims. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
