import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logError } from "./debug";

export const CONFIG_PATH = join(homedir(), ".kev", "config.json");

/**
 * Used when there is no `~/.kev/config.json` (or no override in the
 * environment): Groq's OpenAI-compatible endpoint, the same model Kev shipped
 * with before provider configuration existed.
 */
export const DEFAULT_PROVIDER_CONFIG = {
  providerName: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  model: "qwen/qwen3.8-27b",
  apiKeyEnv: "GROQ_API_KEY",
} as const;

export interface ProviderConfig {
  /** Namespace for provider options and the provider's display name. */
  providerName: string;
  /** URL prefix for API calls, e.g. `https://api.groq.com/openai/v1`. */
  baseURL: string;
  /** Model id handed to the provider. */
  model: string;
  /** Env var the API key is read from; empty means "no key required". */
  apiKeyEnv: string;
  /** Resolved key: `env[apiKeyEnv]` if set, otherwise an inline `apiKey`. */
  apiKey?: string;
}

export interface ResolveOptions {
  /** Config file to read. Defaults to `CONFIG_PATH`. */
  path?: string;
  /** Environment to read overrides and the API key from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** The file-backed fields before the API key is resolved. */
interface ProviderFields {
  providerName: string;
  baseURL: string;
  model: string;
  apiKeyEnv: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(header: Record<string, unknown>, key: string): string | undefined {
  const value = header[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function requireValidURL(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`"${key}" must be a valid URL, got "${value}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`"${key}" must be an http(s) URL, got "${value}"`);
  }
  return value;
}

/**
 * Read, validate and merge the provider configuration with no memoization.
 *
 * Precedence, lowest to highest: the built-in Groq default, `~/.kev/config.json`
 * (fields present in the file win), then the `KEV_*` environment overrides.
 * The API key itself is `env[apiKeyEnv]`, falling back to an inline `apiKey`;
 * an absent key is allowed (local endpoints like Ollama need none) and only
 * surfaces as an auth error when a request is made.
 *
 * Throws a descriptive `Error` for a malformed file, bad field types or an
 * unusable `baseURL` so the caller can surface it instead of guessing.
 */
export function resolveProviderConfig(options: ResolveOptions = {}): ProviderConfig {
  const path = options.path ?? CONFIG_PATH;
  const env = options.env ?? process.env;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      raw = "";
    } else {
      throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const merged: ProviderFields = {
    providerName: DEFAULT_PROVIDER_CONFIG.providerName,
    baseURL: DEFAULT_PROVIDER_CONFIG.baseURL,
    model: DEFAULT_PROVIDER_CONFIG.model,
    apiKeyEnv: DEFAULT_PROVIDER_CONFIG.apiKeyEnv,
  };
  let inlineKey: string | undefined;

  if (raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`${path} must contain a JSON object`);
    }
    for (const key of ["providerName", "baseURL", "model", "apiKeyEnv"] as const) {
      const value = optionalString(parsed, key);
      if (value !== undefined) merged[key] = value;
    }
    inlineKey = optionalString(parsed, "apiKey");
  }

  const overrides: Record<keyof typeof merged, string | undefined> = {
    providerName: env.KEV_PROVIDER,
    baseURL: env.KEV_BASE_URL,
    model: env.KEV_MODEL,
    apiKeyEnv: env.KEV_API_KEY_ENV,
  };
  for (const key of Object.keys(overrides) as (keyof typeof merged)[]) {
    const value = overrides[key];
    if (value !== undefined && value.trim() !== "") merged[key] = value.trim();
  }

  const envKey = env.KEV_API_KEY;
  const apiKey = (merged.apiKeyEnv && env[merged.apiKeyEnv]) || envKey || inlineKey;

  const config: ProviderConfig = {
    providerName: merged.providerName,
    baseURL: requireValidURL(merged.baseURL, "baseURL"),
    model: merged.model,
    apiKeyEnv: merged.apiKeyEnv,
  };
  if (apiKey !== undefined && apiKey !== "") config.apiKey = apiKey;
  return config;
}

let cached: ProviderConfig | null = null;
let cachedError: Error | null = null;

/**
 * `resolveProviderConfig` memoized for the process lifetime. A broken config is
 * logged once and rethrown with the file path attached so the chat can show a
 * clear message instead of an auth failure downstream.
 */
export function getProviderConfig(): ProviderConfig {
  if (cached) return cached;
  if (cachedError) throw cachedError;
  try {
    cached = resolveProviderConfig();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    cachedError = new Error(`invalid provider config: ${reason}`);
    logError("getProviderConfig", error);
    throw cachedError;
  }
  return cached;
}

/** Short model name for the status line; never throws. */
export function getModelLabel(): string {
  try {
    const config = getProviderConfig();
    return config.model.split("/").pop() ?? config.model;
  } catch {
    return "no model";
  }
}
