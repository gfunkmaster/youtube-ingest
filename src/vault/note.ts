import { yamlString, yamlStringArray } from "./frontmatter.js";

/**
 * Input for a YouTube source note. Factual fields (title/author/url/videoId)
 * come from the deterministic metadata tool — the model only supplies the
 * interpretation fields (summary, keyIdeas, quotes, connections, tags).
 */
export interface SourceNoteInput {
  title: string;
  author: string;
  url: string;
  videoId: string;
  /** ISO date (YYYY-MM-DD); omitted from frontmatter when empty. */
  published?: string;
  /** ISO date (YYYY-MM-DD) for created/updated/ingested. */
  ingested: string;
  language?: string;
  /** True when the transcript was cut at the character cap. */
  transcriptTruncated?: boolean;
  /** How many transcript characters were actually available. */
  transcriptChars?: number;
  summary: string;
  keyIdeas: readonly string[];
  quotes?: readonly string[];
  connections?: readonly string[];
  tags?: readonly string[];
  transcript?: string;
}

/** Characters that are unsafe in a filename on macOS/paths, or in Obsidian links. */
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;
const MAX_BASENAME = 120;

/**
 * Builds a vault filename for a source note, e.g.
 * `I Spent 31,141 & 1,000 Hours (video).md` — matching the existing
 * `<name> (video).md` convention in `01-Raw/Videos/`.
 */
export function sourceNoteFileName(title: string): string {
  const cleaned = title
    .replace(FORBIDDEN_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/[.\s]+$/, "");

  const base = (cleaned.length > 0 ? cleaned : "video").slice(0, MAX_BASENAME).trim();
  return `${base} (video).md`;
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function numberedList(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function quoteBlock(items: readonly string[]): string {
  return items.map((item) => `> ${item}`).join("\n>\n");
}

/**
 * Renders the full Markdown source note (frontmatter + body) following
 * `99-System/Templates/source.md` in the Second Brain vault.
 */
export function buildSourceNote(input: SourceNoteInput): string {
  const frontmatter: string[] = [
    "---",
    "type: source",
    `title: ${yamlString(input.title)}`,
    'source_type: "video"',
    `author: ${yamlString(input.author)}`,
    `url: ${yamlString(input.url)}`,
    `published: ${yamlString(input.published ?? "")}`,
    `ingested: ${yamlString(input.ingested)}`,
    `created: ${yamlString(input.ingested)}`,
    `updated: ${yamlString(input.ingested)}`,
    "status: raw",
    `tags: ${yamlStringArray(input.tags ?? [])}`,
    "---",
  ];

  const body: string[] = ["", `# ${input.title}`, ""];

  // A truncated transcript must never be presented as the whole video. This is
  // rendered from the tool's own `truncated` flag — never left to the model to
  // remember, and placed above the summary so it is seen before the claims.
  if (input.transcriptTruncated) {
    const chars =
      typeof input.transcriptChars === "number"
        ? `${new Intl.NumberFormat("sv-SE").format(input.transcriptChars)} tecken`
        : "ett tak";
    body.push(
      "> [!warning] Transkriptet är kapat",
      `> Endast de första ~${chars} hämtades. **Noten bygger inte på hela videon** —`,
      "> sammanfattning och citat täcker bara början. Verifiera mot videon innan du litar på den.",
      "",
    );
  }

  body.push("## Sammanfattning", input.summary.trim(), "");

  if (input.keyIdeas.length > 0) {
    body.push("## Nyckelidéer", numberedList(input.keyIdeas), "");
  }

  if (input.quotes && input.quotes.length > 0) {
    body.push("## Citat", quoteBlock(input.quotes), "");
  }

  if (input.connections && input.connections.length > 0) {
    body.push("## Kopplingar", bulletList(input.connections), "");
  }

  if (input.transcript && input.transcript.trim().length > 0) {
    body.push(
      "## Transkript",
      "<!-- Maskinellt hämtad från YouTube:s undertextspår. Kan innehålla fel. -->",
      input.transcript.trim(),
      "",
    );
  }

  body.push("## Källa", `- ${input.url}`, "");

  return [...frontmatter, ...body].join("\n");
}
