/** Environment variable names to try per provider, in priority order. */
const PROVIDER_API_KEY_ENV: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  "openai-native": ["OPENAI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  "openai-compatible": ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

/** The vault this app writes into when YOUTUBE_INGEST_VAULT is not set. */
export const DEFAULT_VAULT_DIR = "/Users/elminnurkic/Documents/Second Brain";
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AppConfig {
  vaultDir: string;
  providerId: string;
  modelId: string;
  apiKey: string | undefined;
  lang: string | undefined;
}

function firstNonEmpty(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * Reads configuration from the environment. Never throws — a missing API key is
 * reported by the caller with a targeted message for the selected provider.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const providerId = firstNonEmpty(env, ["YOUTUBE_INGEST_PROVIDER"]) ?? DEFAULT_PROVIDER;
  const modelId = firstNonEmpty(env, ["YOUTUBE_INGEST_MODEL"]) ?? DEFAULT_MODEL;
  const vaultDir = firstNonEmpty(env, ["YOUTUBE_INGEST_VAULT"]) ?? DEFAULT_VAULT_DIR;
  const lang = firstNonEmpty(env, ["YOUTUBE_INGEST_LANG"]);

  const keyNames = PROVIDER_API_KEY_ENV[providerId] ?? [];
  const apiKey = firstNonEmpty(env, keyNames);

  return { vaultDir, providerId, modelId, apiKey, lang };
}

/** Human-readable hint for which env var the selected provider needs. */
export function apiKeyHint(providerId: string): string {
  const names = PROVIDER_API_KEY_ENV[providerId];
  return names && names.length > 0
    ? names.join(" eller ")
    : `en API-nyckel för providern "${providerId}"`;
}
