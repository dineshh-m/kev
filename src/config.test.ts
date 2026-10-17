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
  test("falls back to the Groq default when the file is missing", () => {
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config).toMatchObject({
      providerName: DEFAULT_PROVIDER_CONFIG.providerName,
      baseURL: DEFAULT_PROVIDER_CONFIG.baseURL,
      model: DEFAULT_PROVIDER_CONFIG.model,
      apiKeyEnv: DEFAULT_PROVIDER_CONFIG.apiKeyEnv,
    });
    expect(config.apiKey).toBeUndefined();
  });

  test("reads every field from the file", async () => {
    await writeConfig({
      providerName: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config).toEqual({
      providerName: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  test("keeps defaults for fields the file omits", async () => {
    await writeConfig({ model: "llama3.3:70b" });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.model).toBe("llama3.3:70b");
    expect(config.baseURL).toBe(DEFAULT_PROVIDER_CONFIG.baseURL);
    expect(config.providerName).toBe(DEFAULT_PROVIDER_CONFIG.providerName);
  });

  test("KEV_* overrides beat the file", async () => {
    await writeConfig({
      providerName: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
    const config = resolveProviderConfig({
      path: configPath,
      env: {
        KEV_PROVIDER: "custom",
        KEV_BASE_URL: "http://localhost:8080/v1",
        KEV_MODEL: "my-model",
        KEV_API_KEY_ENV: "CUSTOM_KEY",
      },
    });
    expect(config).toMatchObject({
      providerName: "custom",
      baseURL: "http://localhost:8080/v1",
      model: "my-model",
      apiKeyEnv: "CUSTOM_KEY",
    });
  });

  test("resolves the key from env[apiKeyEnv]", async () => {
    await writeConfig({ apiKeyEnv: "MY_KEY" });
    const config = resolveProviderConfig({ path: configPath, env: { MY_KEY: "secret" } });
    expect(config.apiKey).toBe("secret");
  });

  test("uses an inline apiKey when no env key is set", async () => {
    await writeConfig({ apiKey: "inline" });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.apiKey).toBe("inline");
  });

  test("env key wins over an inline apiKey", async () => {
    await writeConfig({ apiKeyEnv: "MY_KEY", apiKey: "inline" });
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
    await writeConfig(["model"]);
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /must contain a JSON object/,
    );
  });

  test("rejects an empty model", async () => {
    await writeConfig({ model: "  " });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"model" must be a non-empty string/,
    );
  });

  test("rejects a non-string baseURL", async () => {
    await writeConfig({ baseURL: 42 });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" must be a non-empty string/,
    );
  });

  test("rejects an unparseable baseURL", async () => {
    await writeConfig({ baseURL: "not a url" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" must be a valid URL/,
    );
  });

  test("rejects a non-http baseURL", async () => {
    await writeConfig({ baseURL: "ftp://example.com" });
    expect(() => resolveProviderConfig({ path: configPath, env: {} })).toThrow(
      /"baseURL" must be an http\(s\) URL/,
    );
  });

  test("accepts a local http baseURL with no key", async () => {
    await writeConfig({ baseURL: "http://localhost:11434/v1", model: "llama3.3:70b" });
    const config = resolveProviderConfig({ path: configPath, env: {} });
    expect(config.baseURL).toBe("http://localhost:11434/v1");
    expect(config.apiKey).toBeUndefined();
  });
});
