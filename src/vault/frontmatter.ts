/** Escapes a value for use as a double-quoted YAML scalar. */
export function yamlString(value: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${cleaned}"`;
}

/** Renders a YAML flow sequence, e.g. `[a, b]`, escaping each element. */
export function yamlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => yamlString(value)).join(", ")}]`;
}
