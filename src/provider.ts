import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ProviderConfig } from "./config";

/**
 * Built-in SDKs read their key from the environment on the first request, which
 * hides a missing key behind an auth failure. Fail up front instead, naming the
 * variable the config actually points at.
 */
function requireKey(config: ProviderConfig): string {
  if (config.apiKey) return config.apiKey;
  const source = config.apiKeyEnv ? `$${config.apiKeyEnv} (or KEV_API_KEY)` : "KEV_API_KEY";
  throw new Error(
    `no API key for provider "${config.provider}": set ${source}, or "apiKey" in ~/.kev/config.json`,
  );
}

/**
 * Build the chat model for the configured provider. Each built-in gets its own
 * SDK so request shapes match the real API — notably Groq, whose chat endpoint
 * rejects the `reasoning_content` field the openai-compatible converter sends.
 * Anything else goes through the openai-compatible SDK under `providerName`.
 */
export function createLanguageModel(config: ProviderConfig): LanguageModelV4 {
  switch (config.provider) {
    case "openai":
      return createOpenAI({ apiKey: requireKey(config), baseURL: config.baseURL })(config.model);
    case "anthropic":
      return createAnthropic({ apiKey: requireKey(config), baseURL: config.baseURL })(config.model);
    case "groq":
      return createGroq({ apiKey: requireKey(config), baseURL: config.baseURL })(config.model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: config.providerName,
        baseURL: config.baseURL,
        apiKey: config.apiKey,
      })(config.model);
  }
}
