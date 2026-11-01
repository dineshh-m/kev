import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logError } from "./debug";

export const CONFIG_PATH = join(homedir(), ".kev", "config.json");

/** The SDK that talks to the endpoint. */
export type ProviderId = "openai" | "anthropic" | "groq" | "openai-compatible";

export const PROVIDER_IDS = ["openai", "anthropic", "groq", "openai-compatible"] as const;

const PROVIDER_LIST = PROVIDER_IDS.join(", ");

/** Fields a provider seeds before the config file and env overrides are applied. */
interface ProviderDefaults {
  /** `providerName` used by the openai-compatible SDK when the user names no provider. */
  providerName: string;
  baseURL?: string;
  model?: string;
  /** Env var read for the key; empty means "no key required". */
  apiKeyEnv: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderDefaults> = {
  openai: {
    providerName: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  anthropic: {
    providerName: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  groq: {
    providerName: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    model: "qwen/qwen3.8-27b",
    apiKeyEnv: "GROQ_API_KEY",
  },
  "openai-compatible": {
    providerName: "custom",
    apiKeyEnv: "",
  },
};

/**
 * Used when there is no `~/.kev/config.json`: Groq's native endpoint
 */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "groq",
  providerName: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  model: "qwen/qwen3.8-27b",
  apiKeyEnv: "GROQ_API_KEY",
};

export interface ProviderConfig {
  /** Which SDK builds the model. */
  provider: ProviderId;
  /**
   * Namespace handed to the openai-compatible SDK. Built-in providers use their
   * id, since their SDK factories fix the name themselves.
   */
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

/** The file-backed fields before defaults and the API key are applied. */
interface FileFields {
  provider?: string;
  providerName?: string;
  baseURL?: string;
  model?: string;
  apiKeyEnv?: string;
  apiKey?: string;
}

interface FileConfig {
  exists: boolean;
  fields: FileFields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canonical provider id, or undefined when the value names something else. */
function matchProviderId(value: string): ProviderId | undefined {
  const normalized = value.toLowerCase();
  return (PROVIDER_IDS as readonly string[]).includes(normalized)
    ? (normalized as ProviderId)
    : undefined;
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

/** Env value if it is set and not blank. */
function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

/** Read and validate the file fields; a missing file is not an error. */
function readFileConfig(path: string): FileConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, fields: {} };
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (raw.trim() === "") return { exists: false, fields: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  const fields: FileFields = {};
  for (const key of ["provider", "providerName", "baseURL", "model", "apiKeyEnv", "apiKey"] as const) {
    const value = optionalString(parsed, key);
    if (value !== undefined) fields[key] = value;
  }
  return { exists: true, fields };
}

/**
 * Pick the provider. An explicit `provider` wins, then the file (where the field
 * is required), then the built-in Groq default when there is no file at all.
 * `KEV_PROVIDER` may hold a legacy provider *name*; that resolves to an
 * openai-compatible endpoint so old env-only configs keep working.
 */
function resolveProviderId(file: FileConfig, env: NodeJS.ProcessEnv): ProviderId {
  const fromEnv = envValue(env, "KEV_PROVIDER");
  if (fromEnv !== undefined) {
    return matchProviderId(fromEnv) ?? "openai-compatible";
  }

  if (!file.exists) return DEFAULT_PROVIDER_CONFIG.provider;

  const value = file.fields.provider;
  if (value === undefined) {
    throw new Error(`"provider" is required, one of ${PROVIDER_LIST}`);
  }
  const provider = matchProviderId(value);
  if (provider === undefined) {
    throw new Error(
      `"provider" must be one of ${PROVIDER_LIST}, got "${value}" — use "providerName" to name a custom endpoint`,
    );
  }
  return provider;
}

function resolveProviderName(
  provider: ProviderId,
  file: FileConfig,
  env: NodeJS.ProcessEnv,
): string {
  // Built-in SDKs pick their own name, so a stale `providerName` cannot mislabel them.
  if (provider !== "openai-compatible") return provider;

  return (
    envValue(env, "KEV_PROVIDER_NAME") ??
    file.fields.providerName ??
    PROVIDER_DEFAULTS[provider].providerName
  );
}

/**
 * Read, validate and merge the provider configuration with no memoization.
 *
 * Precedence, lowest to highest: the provider's defaults, `~/.kev/config.json`
 * (fields present in the file win), then the `KEV_*` environment overrides.
 * `provider` selects the defaults, so it is resolved first; when the file
 * exists it must name one. The API key itself is `env[apiKeyEnv]`, falling back
 * to `KEV_API_KEY` and then an inline `apiKey`; an absent key is allowed (local
 * endpoints like Ollama need none) and only surfaces when a request is made.
 *
 * Throws a descriptive `Error` for a malformed file, bad field types, a missing
 * or unknown `provider`, or an unusable `baseURL` so the caller can surface it
 * instead of guessing.
 */
export function resolveProviderConfig(options: ResolveOptions = {}): ProviderConfig {
  const path = options.path ?? CONFIG_PATH;
  const env = options.env ?? process.env;

  const file = readFileConfig(path);
  const provider = resolveProviderId(file, env);
  const defaults = PROVIDER_DEFAULTS[provider];

  const providerName = resolveProviderName(provider, file, env);

  const baseURL = envValue(env, "KEV_BASE_URL") ?? file.fields.baseURL ?? defaults.baseURL;
  if (baseURL === undefined) {
    throw new Error(`"baseURL" is required when provider is "${provider}"`);
  }

  const model = envValue(env, "KEV_MODEL") ?? file.fields.model ?? defaults.model;
  if (model === undefined) {
    throw new Error(`"model" is required when provider is "${provider}"`);
  }

  const apiKeyEnv = envValue(env, "KEV_API_KEY_ENV") ?? file.fields.apiKeyEnv ?? defaults.apiKeyEnv;

  const envKey = apiKeyEnv ? env[apiKeyEnv] : undefined;
  const apiKey = envKey || env.KEV_API_KEY || file.fields.apiKey;

  const config: ProviderConfig = {
    provider,
    providerName,
    baseURL: requireValidURL(baseURL, "baseURL"),
    model,
    apiKeyEnv,
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
