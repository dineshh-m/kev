import { APICallError } from "ai";

/** Longest provider response body echoed into the transcript (the log keeps it all). */
const MAX_BODY_CHARS = 400;
/** Longest explanation shown in the chat; a stack would drown the conversation. */
const MAX_ERROR_CHARS = 700;
/** How deep to follow an `error.cause` chain. */
const MAX_CAUSE_DEPTH = 4;

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function collect(error: unknown, seen: Set<unknown>, depth: number): string[] {
  if (error == null) return ["unknown error"];
  if (depth > MAX_CAUSE_DEPTH) return [];
  if (typeof error !== "object") return [clip(oneLine(String(error)), 200)];
  if (seen.has(error)) return []; // a self-referential cause chain must not loop
  seen.add(error);

  if (APICallError.isInstance(error)) {
    const segments: string[] = [];
    if (error.statusCode != null) segments.push(`HTTP ${error.statusCode}`);
    const message = oneLine(error.message);
    if (message) segments.push(message);
    if (error.url) segments.push(error.url);
    const body = oneLine(error.responseBody ?? "");
    if (body && !body.includes(message) && !message.includes(body)) {
      segments.push(`response: ${clip(body, MAX_BODY_CHARS)}`);
    }
    if (error.cause != null) segments.push(...collect(error.cause, seen, depth + 1));
    return segments;
  }

  if (error instanceof Error) {
    const segments: string[] = [];
    const message = oneLine(error.message);
    const label = error.name && error.name !== "Error" ? `${error.name}: ${message}` : message;
    if (label) segments.push(label);

    // Node network failures hang the reason (ECONNREFUSED, ENOTFOUND, ...) off `code`.
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && !label.includes(code)) segments.push(code);

    if (error.cause != null && error.cause !== error) {
      segments.push(...collect(error.cause, seen, depth + 1));
    }
    return segments;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) return [oneLine(message)];

  try {
    return [clip(oneLine(JSON.stringify(error)), MAX_BODY_CHARS)];
  } catch {
    return ["unrecognized error"];
  }
}

/**
 * Turn a failed model call into a specific, one-paragraph explanation for the
 * transcript. The AI SDK's `toUIMessageStream` masks errors with "An error
 * occurred." by default so server details never leak to a browser client; Kev
 * talks to the provider straight from the user's machine, so surfacing the
 * real reason (HTTP status, provider message, connection error) is the point.
 *
 * Never throws: the caller is already on an error path. The full error,
 * including its stack, still goes to `~/.kev/kev.log` via `logError`.
 */
export function describeError(error: unknown): string {
  const text = collect(error, new Set(), 0).join(" · ");
  return clip(text || "unknown error", MAX_ERROR_CHARS);
}
