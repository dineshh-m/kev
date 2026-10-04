import type { UIMessage } from "ai";
import type { KevCommand } from "./commands";
import type { RunData } from "./exec";

/**
 * The transcript is everything the UI renders, in order. A command run is a
 * UI-only entry: it holds the command's output and exit status for the person
 * using the app and never reaches the model.
 */
export interface RunEntry {
  kind: "run";
  id: string;
  data: RunData;
}

export interface MessageEntry {
  kind: "message";
  id: string;
  message: UIMessage;
}

export type TranscriptEntry = RunEntry | MessageEntry;

export function isRunEntry(entry: TranscriptEntry): entry is RunEntry {
  return entry.kind === "run";
}

export function messageEntry(message: UIMessage): MessageEntry {
  return { kind: "message", id: message.id, message };
}

export function runEntry(id: string, command: KevCommand): RunEntry {
  return {
    kind: "run",
    id,
    data: {
      name: command.name,
      type: command.type,
      status: "running",
      stdout: "",
      stderr: "",
      code: null,
      signal: null,
      durationMs: 0,
      truncated: false,
    },
  };
}

/**
 * The slice of the transcript the model is allowed to see. Run entries are
 * dropped here, so no command output or exit status can leak into context
 * regardless of what `convertToModelMessages` does with message parts.
 */
export function chatMessages(entries: TranscriptEntry[]): UIMessage[] {
  return entries.filter((entry) => !isRunEntry(entry)).map((entry) => entry.message);
}