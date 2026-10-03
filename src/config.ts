import { Llms } from "@cline/sdk";

/** The vault this app writes into when YOUTUBE_INGEST_VAULT is not set. */
export const DEFAULT_VAULT_DIR = "/Users/elminnurkic/Documents/Second Brain";
export const DEFAULT_PROVIDER = "anthropic";

export interface AppConfig {
  vaultDir: string;
  providerId: string;
  modelId: string;
  apiKey: string | undefined;
  /** Env vars the provider reads its key from (from the SDK registry). */
  apiKeyEnvNames: readonly string[];
  /** False for providers pointing at a local endpoint, where a key is optional. */
  requiresApiKey: boolean;
  /** True when the model came from env/CLI rather than the provider default. */
  modelIdIsExplicit: boolean;
  /** The provider's own default model, used in warnings. */
  providerDefaultModelId: string;
  lang: string | undefined;
}

/** Explicit CLI overrides; each falls back to env, then to the SDK registry. */
export interface ConfigOverrides {
  providerId?: string;
  modelId?: string;
  vaultDir?: string;
  lang?: string;
}

export class UnknownProviderError extends Error {
  constructor(providerId: string) {
    super(
      `Okänd provider "${providerId}". Kör "npm run dev -- --list-providers" för ` +
        "att se alla giltiga id:n.",
    );
    this.name = "UnknownProviderError";
  }
}

/**
 * The subset of the SDK's provider descriptor this app depends on. Declared
 * locally because `Llms` (the `@cline/sdk` re-export) is loosely typed, so
 * naming the fields we actually read keeps the call sites checked.
 */
interface RegistryProvider {
  id: string;
  name: string;
  defaultModelId: string;
  env?: readonly string[];
  baseUrl?: string;
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
 * The env vars a provider reads its key from. The SDK registry is authoritative;
 * if a provider declares none, `<PROVIDER_ID>_API_KEY` is derived as a fallback.
 */
export function providerEnvNames(
  providerId: string,
  registryEnv?: readonly string[],
): readonly string[] {
  if (registryEnv && registryEnv.length > 0) return registryEnv;
  return [`${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`];
}

/** True when the provider points at a local server (localhost, 127.0.0.1, ...). */
export function isLocalEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

/**
 * Resolves configuration from the SDK's provider registry, so every provider the
 * SDK knows about works — no provider list is hardcoded here.
 */
export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ConfigOverrides = {},
): Promise<AppConfig> {
  const providerId =
    overrides.providerId ??
    firstNonEmpty(env, ["YOUTUBE_INGEST_PROVIDER"]) ??
    DEFAULT_PROVIDER;

  const provider = (await Llms.getProvider(providerId)) as RegistryProvider | undefined;
  if (!provider) throw new UnknownProviderError(providerId);

  const apiKeyEnvNames = providerEnvNames(providerId, provider.env);
  const explicitModelId =
    overrides.modelId ?? firstNonEmpty(env, ["YOUTUBE_INGEST_MODEL"]);

  return {
    vaultDir:
      overrides.vaultDir ??
      firstNonEmpty(env, ["YOUTUBE_INGEST_VAULT"]) ??
      DEFAULT_VAULT_DIR,
    providerId,
    modelId: explicitModelId ?? provider.defaultModelId,
    apiKey: firstNonEmpty(env, apiKeyEnvNames),
    apiKeyEnvNames,
    requiresApiKey: !isLocalEndpoint(provider.baseUrl),
    modelIdIsExplicit: explicitModelId !== undefined,
    providerDefaultModelId: provider.defaultModelId,
    lang: overrides.lang ?? firstNonEmpty(env, ["YOUTUBE_INGEST_LANG"]),
  };
}

/**
 * Whether `modelId` is listed for the provider. `undefined` means "cannot tell"
 * because the provider declares no models — callers must not warn in that case.
 */
export async function modelExistsForProvider(
  providerId: string,
  modelId: string,
): Promise<boolean | undefined> {
  const models = (await Llms.getModelsForProvider(providerId)) as
    | Record<string, unknown>
    | undefined;
  const ids = models ? Object.keys(models) : [];
  if (ids.length === 0) return undefined;
  return ids.includes(modelId);
}

export interface ProviderSummary {
  id: string;
  name: string;
  defaultModelId: string;
  envNames: readonly string[];
  /** True when one of `envNames` is set in the environment. */
  hasKey: boolean;
  isDefault: boolean;
}

/** Every provider the SDK knows about, for `--list-providers`. */
export async function listProviders(
  env: NodeJS.ProcessEnv = process.env,
  defaultProvider: string = DEFAULT_PROVIDER,
): Promise<ProviderSummary[]> {
  const providers = (await Llms.getAllProviders()) as RegistryProvider[];
  return providers
    .map((provider: RegistryProvider) => {
      const envNames = providerEnvNames(provider.id, provider.env);
      return {
        id: provider.id,
        name: provider.name,
        defaultModelId: provider.defaultModelId,
        envNames,
        hasKey: firstNonEmpty(env, envNames) !== undefined,
        isDefault: provider.id === defaultProvider,
      };
    })
    .sort((a: ProviderSummary, b: ProviderSummary) => a.id.localeCompare(b.id));
}
