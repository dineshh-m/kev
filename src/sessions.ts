import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isToolUIPart, type UIMessage } from "ai";
import { logError } from "./debug";
import type { TranscriptEntry } from "./transcript";

export const SESSIONS_DIR = join(homedir(), ".kev", "sessions");

export const SESSION_VERSION = 1;

/**
 * One persisted transcript. `cwd` is recorded so the resume picker can show
 * which project a session belongs to; the transcript itself is exactly what
 * the UI renders — chat messages plus command runs — serialized as-is.
 */
export interface StoredSession {
  version: number;
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  entries: TranscriptEntry[];
}

/** The rows the resume picker shows; no transcript payload. */
export interface SessionSummary {
  id: string;
  cwd: string;
  updatedAt: string;
  entryCount: number;
  preview: string;
}

const PREVIEW_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function newSessionRecord(cwd: string = process.cwd()): StoredSession {
  const now = new Date().toISOString();
  return {
    version: SESSION_VERSION,
    id: crypto.randomUUID(),
    cwd,
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
}

export function sessionPath(id: string, dir: string = SESSIONS_DIR): string {
  return join(dir, `${id}.json`);
}

/**
 * Repair a transcript that was cut short by a crash or an aborted stream.
 * Runs stuck mid-flight and half-written message parts are settled into their
 * terminal shapes so the UI does not render a perpetual spinner and
 * `convertToModelMessages` never sees a dangling tool call with no result.
 */
export function sanitizeEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "run") {
      if (entry.data.status !== "running") return entry;
      return { ...entry, data: { ...entry.data, status: "cancelled" } };
    }

    const parts = entry.message.parts.filter((part) => {
      // A tool call that never produced output has nothing to resume; a
      // terminal part (output-available / output-error / output-denied)
      // round-trips into model context fine.
      if (isToolUIPart(part)) {
        return part.state !== "input-streaming" && part.state !== "input-available";
      }
      return true;
    });

    const message: UIMessage = {
      ...entry.message,
      parts: parts.map((part) =>
        part.type === "text" && part.state !== "done" ? { ...part, state: "done" } : part,
      ),
    };
    return { ...entry, message };
  });
}

function parseStoredSession(id: string, raw: string): StoredSession {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("session file is not a mapping");
  if (parsed.version !== SESSION_VERSION) {
    throw new Error(`unsupported session version ${String(parsed.version)}`);
  }
  if (!isString(parsed.id) || !isString(parsed.cwd) || !isString(parsed.createdAt) || !isString(parsed.updatedAt)) {
    throw new Error("session file is missing id/cwd/timestamps");
  }
  if (!Array.isArray(parsed.entries)) throw new Error("session entries must be a list");

  // Structural trust: entries were written by us, and the UI already defends
  // against malformed parts. Only the crash-repair pass runs here.
  return {
    version: SESSION_VERSION,
    id: parsed.id,
    cwd: parsed.cwd,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    entries: sanitizeEntries(parsed.entries as TranscriptEntry[]),
  };
}

/**
 * Write to a temp file then rename, so a crash mid-write cannot leave a torn
 * session file that `loadSession` would then reject.
 */
export async function saveSession(session: StoredSession, dir: string = SESSIONS_DIR): Promise<void> {
  const path = sessionPath(session.id, dir);
  const temp = `${path}.tmp`;

  await mkdir(dir, { recursive: true });
  await writeFile(temp, JSON.stringify(session), "utf8");
  await rename(temp, path);
}

export async function loadSession(id: string, dir: string = SESSIONS_DIR): Promise<StoredSession | null> {
  try {
    return parseStoredSession(id, await readFile(sessionPath(id, dir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      logError(`loadSession:${id}`, error);
      return null;
    }
    logError(`loadSession:${id}`, error);
    throw error;
  }
}

function previewOf(entries: TranscriptEntry[]): string {
  for (const entry of entries) {
    if (entry.kind !== "message" || entry.message.role !== "user") continue;
    const text = entry.message.parts
      .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
  }
  return "(no messages)";
}

/** Newest first. A corrupt or unsupported file is skipped, never fatal. */
export async function listSessions(dir: string = SESSIONS_DIR): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logError(`listSessions:${dir}`, error);
    }
    return [];
  }

  const sessions: SessionSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -".json".length);
    try {
      const session = await loadSession(id, dir);
      if (session === null || session.entries.length === 0) continue;
      sessions.push({
        id: session.id,
        cwd: session.cwd,
        updatedAt: session.updatedAt,
        entryCount: session.entries.length,
        preview: previewOf(session.entries),
      });
    } catch (error) {
      // Corrupt file: leave it on disk, keep listing the rest.
      logError(`listSessions:${file}`, error);
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}
