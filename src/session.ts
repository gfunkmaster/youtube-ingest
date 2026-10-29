/**
 * Per-run state shared between tools.
 *
 * Exists for one reason: the transcript is a source document. Routing it through
 * the model (as a `write_source_note` argument) would make the model re-emit up
 * to 120 000 characters as output tokens — costly, slow, and it would let the
 * model paraphrase the source. Instead the transcript tool hands it over
 * directly, and the note tool attaches it verbatim.
 */
export interface TranscriptHandoff {
  videoId: string;
  language: string;
  /** The transcript text, capped at the configured character limit. */
  text: string;
  /** True when `text` was capped. */
  truncated: boolean;
  /** Length of the text that was kept. */
  chars: number;
  /** Length of the full transcript before any cap. */
  totalChars: number;
  /** Caption track or local ASR; drives how the note annotates the block. */
  source?: "captions" | "asr";
}

export interface IngestSession {
  /** Set by the transcript tool on success; read by the note tool. */
  transcript?: TranscriptHandoff;
}

export function createIngestSession(): IngestSession {
  return {};
}
