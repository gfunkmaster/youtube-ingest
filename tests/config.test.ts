import { describe, expect, it } from "vitest";

import {
  isLocalEndpoint,
  listProviders,
  loadConfig,
  modelExistsForProvider,
  providerEnvNames,
  UnknownProviderError,
} from "../src/config.js";

describe("providerEnvNames", () => {
  it("prefers the env names declared by the SDK registry", () => {
    expect(providerEnvNames("deepseek", ["DEEPSEEK_API_KEY"])).toEqual([
      "DEEPSEEK_API_KEY",
    ]);
  });

  it("derives <ID>_API_KEY when the registry declares none", () => {
    expect(providerEnvNames("some-provider")).toEqual(["SOME_PROVIDER_API_KEY"]);
    expect(providerEnvNames("x")).toEqual(["X_API_KEY"]);
  });

  it("ignores an empty registry array", () => {
    expect(providerEnvNames("groq", [])).toEqual(["GROQ_API_KEY"]);
  });
});

describe("isLocalEndpoint", () => {
  it.each([
    ["http://localhost:11434", true],
    ["http://127.0.0.1:1234/v1", true],
    ["https://api.deepseek.com/v1", false],
    ["https://api.anthropic.com/v1", false],
    [undefined, false],
    ["not a url", false],
  ])("%s -> %s", (baseUrl, expected) => {
    expect(isLocalEndpoint(baseUrl as string | undefined)).toBe(expected);
  });
});

describe("loadConfig", () => {
  it("resolves the key env var from the SDK registry (deepseek)", async () => {
    const config = await loadConfig({
      YOUTUBE_INGEST_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "sk-test-not-real",
    });

    expect(config.providerId).toBe("deepseek");
    expect(config.apiKeyEnvNames).toEqual(["DEEPSEEK_API_KEY"]);
    expect(config.apiKey).toBe("sk-test-not-real");
    expect(config.modelId).toBe("deepseek-v4-flash");
    expect(config.requiresApiKey).toBe(true);
  });

  it("lets explicit overrides win over the environment", async () => {
    const config = await loadConfig(
      { YOUTUBE_INGEST_PROVIDER: "anthropic" },
      { providerId: "groq", modelId: "my-model" },
    );

    expect(config.providerId).toBe("groq");
    expect(config.modelId).toBe("my-model");
    expect(config.apiKeyEnvNames).toEqual(["GROQ_API_KEY"]);
  });

  it("marks a local provider as not requiring a key", async () => {
    const config = await loadConfig({ YOUTUBE_INGEST_PROVIDER: "ollama" });
    expect(config.requiresApiKey).toBe(false);
  });

  it("throws UnknownProviderError for an unknown provider", async () => {
    await expect(
      loadConfig({ YOUTUBE_INGEST_PROVIDER: "definitely-not-a-real-provider" }),
    ).rejects.toBeInstanceOf(UnknownProviderError);
  });

  it("does not treat the provider default as an explicit model", async () => {
    const config = await loadConfig({ YOUTUBE_INGEST_PROVIDER: "deepseek" });
    expect(config.modelIdIsExplicit).toBe(false);
    expect(config.modelId).toBe("deepseek-v4-flash");
    expect(config.providerDefaultModelId).toBe("deepseek-v4-flash");
  });

  it("keeps a stale cross-provider model so the caller can warn about it", async () => {
    const config = await loadConfig({
      YOUTUBE_INGEST_PROVIDER: "deepseek",
      YOUTUBE_INGEST_MODEL: "claude-sonnet-4-6",
    });

    expect(config.modelIdIsExplicit).toBe(true);
    expect(config.modelId).toBe("claude-sonnet-4-6");

    await expect(modelExistsForProvider("deepseek", "claude-sonnet-4-6")).resolves.toBe(false);
    await expect(modelExistsForProvider("deepseek", "deepseek-v4-flash")).resolves.toBe(true);
  });

  it("falls back to the default provider and vault", async () => {
    const config = await loadConfig({});
    expect(config.providerId).toBe("anthropic");
    expect(config.vaultDir).toContain("Second Brain");
    expect(config.apiKey).toBeUndefined();
  });
});

describe("listProviders", () => {
  it("returns the whole registry, marking keys present and the default", async () => {
    const providers = await listProviders({ DEEPSEEK_API_KEY: "x" }, "deepseek");

    expect(providers.length).toBeGreaterThan(100);
    expect(providers.find((provider) => provider.id === "deepseek")).toMatchObject({
      envNames: ["DEEPSEEK_API_KEY"],
      hasKey: true,
      isDefault: true,
    });
    expect(providers.find((provider) => provider.id === "anthropic")?.hasKey).toBe(false);
  });
});
