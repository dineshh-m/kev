import { describe, expect, test } from "bun:test";
import type { ProviderConfig } from "./config";
import { createLanguageModel } from "./provider";

function config(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    provider: "openai-compatible",
    providerName: "custom",
    baseURL: "http://localhost:11434/v1",
    model: "test-model",
    apiKeyEnv: "",
    apiKey: "test-key",
    ...overrides,
  };
}

describe("createLanguageModel", () => {
  test("uses the native SDK for each built-in provider", () => {
    expect(createLanguageModel(config({ provider: "openai" })).provider).toBe("openai.responses");
    expect(createLanguageModel(config({ provider: "anthropic" })).provider).toBe("anthropic.messages");
    expect(createLanguageModel(config({ provider: "groq" })).provider).toBe("groq.chat");
  });

  test("keeps the model id", () => {
    expect(createLanguageModel(config({ provider: "groq", model: "openai/gpt-oss-20b" })).modelId).toBe(
      "openai/gpt-oss-20b",
    );
  });

  test("uses providerName as the openai-compatible namespace", () => {
    const model = createLanguageModel(config({ providerName: "my-gateway" }));
    expect(model.provider).toBe("my-gateway.chat");
  });

  test("rejects a missing key for a built-in provider", () => {
    expect(() =>
      createLanguageModel(config({ provider: "groq", apiKey: undefined, apiKeyEnv: "GROQ_API_KEY" })),
    ).toThrow(/no API key for provider "groq": set \$GROQ_API_KEY/);
  });

  test("allows a keyless openai-compatible endpoint", () => {
    expect(() => createLanguageModel(config({ apiKey: undefined }))).not.toThrow();
  });
});
