import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDER_CONFIG, resolveProviderConfig } from "./config";

let dir: string;
let configPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kev-config-"));
  configPath = join(dir, "config.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(value: unknown) {
  await writeFile(configPath, typeof value === "string" ? value : JSON.stringify(value));
}

describe("resolveProviderConfig", () => {
  test("falls back to the Groq preset when the file is missing", () => {
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config).toEqual(DEFAULT_PROVIDER_CONFIG);
    expect(config.apiKey).toBeUndefined();
  });

  test("treats an empty file like a missing one", async () => {
    await writeConfig("   \n");
    expect(resolveProviderConfig({ path: configPath, env: {} })).toEqual(DEFAULT_PROVIDER_CONFIG);
  });

  test("requires provider when the file exists", async () => {
    await writeConfig({ model: "llama3.3:70b" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"provider" is required/,
    );
  });

  test("rejects an unknown provider", async () => {
    await writeConfig({ provider: "openrouter", baseURL: "https://openrouter.ai/api/v1" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"provider" must be one of openai, anthropic, groq, openai-compatible/,
    );
  });

  test("reads every field from the file", async () => {
    await writeConfig({
      provider: "openai-compatible",
      providerName: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config).toEqual({
      provider: "openai-compatible",
      providerName: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  test("seeds each built-in provider's endpoint and key variable", async () => {
    for (const [provider, baseURL, apiKeyEnv] of [
      ["openai", "https://api.openai.com/v1", "OPENAI_API_KEY"],
      ["anthropic", "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY"],
      ["groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY"],
    ] as const) {
      await writeConfig({ provider, model: "some-model" });
      const config = resolveProviderConfig({ path: configPath, env: {} });
      expect(config).toMatchObject({ provider, providerName: provider, baseURL, apiKeyEnv, model: "some-model" });
    }
  });

  test("keeps the Groq default model", async () => {
    await writeConfig({ provider: "groq" });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.model).toBe(DEFAULT_PROVIDER_CONFIG.model);
  });

  test("requires a model for the other providers", async () => {
    for (const provider of ["openai", "anthropic", "openai-compatible"] as const) {
      await writeConfig({ provider, baseURL: "https://example.com/v1" });
      expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
        new RegExp(`"model" is required when provider is "${provider}"`),
      );
    }
  });

  test("requires a baseURL for openai-compatible", async () => {
    await writeConfig({ provider: "openai-compatible", model: "some-model" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" is required when provider is "openai-compatible"/,
    );
  });

  test("defaults providerName to custom for openai-compatible", async () => {
    await writeConfig({
      provider: "openai-compatible",
      baseURL: "http://localhost:11434/v1",
      model: "llama3.3:70b",
    });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.providerName).toBe("custom");
    expect(config.apiKeyEnv).toBe("");
  });

  test("matches a provider id case-insensitively", async () => {
    await writeConfig({ provider: "Groq" });
    expect(resolveProviderConfig({ path: configPath, env: {} }).provider).toBe("groq");
  });

  test("ignores providerName for a built-in provider", async () => {
    await writeConfig({ provider: "anthropic", providerName: "groq", model: "claude-sonnet-4.5" });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.providerName).toBe("anthropic");
  });

  test("KEV_* overrides beat the file", async () => {
    await writeConfig({
      provider: "openai-compatible",
      providerName: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
    const config = resolveProviderConfig({
      path: configPath,
      env: {
        KEV_PROVIDER: "groq",
        KEV_PROVIDER_NAME: "custom",
        KEV_BASE_URL: "http://localhost:8080/v1",
        KEV_MODEL: "my-model",
        KEV_API_KEY_ENV: "CUSTOM_KEY",
      },
    });
    expect(config).toMatchObject({
      provider: "groq",
      providerName: "groq",
      baseURL: "http://localhost:8080/v1",
      model: "my-model",
      apiKeyEnv: "CUSTOM_KEY",
    });
  });

  test("a legacy KEV_PROVIDER name means openai-compatible", () => {
    const config = resolveProviderConfig({
      path: configPath,
      env: {
        KEV_PROVIDER: "custom",
        KEV_BASE_URL: "http://localhost:8080/v1",
        KEV_MODEL: "my-model",
      },
    });
    expect(config).toMatchObject({
      provider: "openai-compatible",
      providerName: "custom",
      baseURL: "http://localhost:8080/v1",
      model: "my-model",
    });
  });

  test("KEV_PROVIDER_NAME beats the legacy provider name", () => {
    const config = resolveProviderConfig({
      path: configPath,
      env: {
        KEV_PROVIDER: "legacy-name",
        KEV_PROVIDER_NAME: "explicit-name",
        KEV_BASE_URL: "http://localhost:8080/v1",
        KEV_MODEL: "my-model",
      },
    });
    expect(config.providerName).toBe("explicit-name");
  });

  test("resolves the key from env[apiKeyEnv]", async () => {
    await writeConfig({ provider: "groq", apiKeyEnv: "MY_KEY" });
    const config = resolveProviderConfig({ path: configPath, env: { MY_KEY: "secret" } });
    expect(config.apiKey).toBe("secret");
  });

  test("uses an inline apiKey when no env key is set", async () => {
    await writeConfig({ provider: "groq", apiKey: "inline" });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.apiKey).toBe("inline");
  });

  test("env key wins over an inline apiKey", async () => {
    await writeConfig({ provider: "groq", apiKeyEnv: "MY_KEY", apiKey: "inline" });
    const config = resolveProviderConfig({ path: configPath, env: { MY_KEY: "secret" } });
    expect(config.apiKey).toBe("secret");
  });

  test("KEV_API_KEY is used when apiKeyEnv holds nothing", async () => {
    const config = resolveProviderConfig({ path: configPath, env: { KEV_API_KEY: "secret" } });
    expect(config.apiKey).toBe("secret");
  });

  test("rejects malformed JSON", async () => {
    await writeConfig("{ not json");
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /is not valid JSON/,
    );
  });

  test("rejects a non-object file", async () => {
    await writeConfig(["provider"]);
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /must contain a JSON object/,
    );
  });

  test("rejects an empty model", async () => {
    await writeConfig({ provider: "groq", model: "  " });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"model" must be a non-empty string/,
    );
  });

  test("rejects a non-string baseURL", async () => {
    await writeConfig({ provider: "groq", baseURL: 42 });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" must be a non-empty string/,
    );
  });

  test("rejects an unparseable baseURL", async () => {
    await writeConfig({ provider: "groq", baseURL: "not a url" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" must be a valid URL/,
    );
  });

  test("rejects a non-http baseURL", async () => {
    await writeConfig({ provider: "groq", baseURL: "ftp://example.com" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" must be an http\(s\) URL/,
    );
  });

  test("accepts a local http baseURL with no key", async () => {
    await writeConfig({
      provider: "openai-compatible",
      baseURL: "http://localhost:11434/v1",
      model: "llama3.3:70b",
    });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.baseURL).toBe("http://localhost:11434/v1");
    expect(config.apiKey).toBeUndefined();
  });
});
