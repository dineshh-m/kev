import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { readUIMessageStream, toUIMessageStream, type UIMessage } from "ai";
import { streamAssistantResponse } from "./ai";
import { filterCommands, loadCommands, type KevCommand } from "./commands";
import { runCommand, type RunData } from "./exec";
import {
  chatMessages,
  messageEntry,
  runEntry,
  type TranscriptEntry,
} from "./transcript";
import { AiMessage } from "./components/AiMessage";
import { AsciiBanner } from "./components/AsciiBanner";
import { CommandPalette } from "./components/CommandPalette";
import { CommandRun } from "./components/CommandRun";
import { Spinner } from "./components/Spinner";
import { UserMessage } from "./components/UserMessage";

const SLASH_QUERY = /^\/(\S*)$/;
const OUTPUT_CHAR_BUDGET = 256 * 1024;
const OUTPUT_MAX_LINES = 200;

const THINKING_VERBS = [
  "Unleashing",
  "Pondering",
  "Consulting",
  "Reticulating",
  "Herding",
  "Rambling",
  "Staring",
  "Convincing",
  "Asking",
  "Divining",
  "Taming",
  "Assembling",
  "Interpolating",
  "Shaking",
  "Unspooling",
  "Percolating",
  "Twiddling",
  "Waiting",
  "Brewing",
  "Cogitating",
  "Flipping",
  "Reading",
  "Second-guessing",
  "Mulling",
  "Prompting",
  "Considering",
  "Talking",
  "Humming",
  "Spelunking",
] as const;

function pickVerb(exclude?: string): string {
  const pool = exclude ? THINKING_VERBS.filter((verb) => verb !== exclude) : THINKING_VERBS;
  return pool[Math.floor(Math.random() * pool.length)] ?? THINKING_VERBS[0];
}

type Status = "idle" | "streaming" | "running";

function userText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function appendOutput(current: string, text: string): { text: string; truncated: boolean } {
  const combined = current + text;
  if (combined.length <= OUTPUT_CHAR_BUDGET) return { text: combined, truncated: false };

  const lines = combined.slice(0, OUTPUT_CHAR_BUDGET).split("\n");
  if (lines.length <= OUTPUT_MAX_LINES) {
    return { text: combined.slice(0, OUTPUT_CHAR_BUDGET), truncated: true };
  }
  return {
    text: `${lines.slice(0, OUTPUT_MAX_LINES).join("\n")}\n… output truncated`,
    truncated: true,
  };
}

function EntryView({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "run") return <CommandRun data={entry.data} />;
  const { message } = entry;
  return message.role === "user" ? (
    <UserMessage content={userText(message)} />
  ) : (
    <AiMessage message={message} />
  );
}

export function App() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [commands, setCommands] = useState<KevCommand[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingConfirm, setPendingConfirm] = useState<KevCommand | null>(null);
  const [thinkingVerb, setThinkingVerb] = useState<string>(() => pickVerb());

  const activeRunRef = useRef<{ id: string; controller: AbortController } | null>(null);
  // Authority for "is something already in flight". `status` mirrors it for
  // rendering but state updates are not visible until the next render, so a
  // held-down Enter could otherwise start a second run.
  const busyRef = useRef(false);

  const slashMatch = SLASH_QUERY.exec(draft);
  const isPaletteOpen = slashMatch !== null;
  const query = slashMatch?.[1] ?? null;
  const matches = useMemo(
    () => (query === null ? [] : filterCommands(commands, query)),
    [commands, query],
  );
  const activeIndex = Math.min(selectedIndex, Math.max(matches.length - 1, 0));

  const refreshCommands = useCallback(() => {
    void loadCommands().then((result) => {
      setCommands(result.commands);
      setLoadErrors(result.errors);
    });
  }, []);

  useEffect(() => {
    refreshCommands();
  }, [refreshCommands]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isPaletteOpen) refreshCommands();
  }, [isPaletteOpen, refreshCommands]);

  useEffect(() => {
    return () => {
      activeRunRef.current?.controller.abort();
    };
  }, []);

  const updateEntryById = useCallback(
    (id: string, update: (entry: TranscriptEntry) => TranscriptEntry) => {
      setEntries((prev) => prev.map((entry) => (entry.id === id ? update(entry) : entry)));
    },
    [],
  );

  const patchRun = useCallback(
    (id: string, patch: (run: RunData) => RunData) => {
      updateEntryById(id, (entry) =>
        entry.kind === "run" ? { ...entry, data: patch(entry.data) } : entry,
      );
    },
    [updateEntryById],
  );

  const executeCommand = useCallback(
    async (command: KevCommand) => {
      if (busyRef.current) return;
      busyRef.current = true;

      const id = crypto.randomUUID();
      const controller = new AbortController();
      const startedAt = performance.now();
      activeRunRef.current = { id, controller };

      setEntries((prev) => [...prev, runEntry(id, command)]);
      setDraft("");
      setPendingConfirm(null);
      setStatus("running");

      try {
        for await (const event of runCommand(command, { signal: controller.signal })) {
          if (event.type === "chunk") {
            patchRun(id, (run) => {
              const next = appendOutput(
                event.stream === "stdout" ? run.stdout : run.stderr,
                event.text,
              );
              return {
                ...run,
                [event.stream]: next.text,
                truncated: run.truncated || next.truncated,
              };
            });
            continue;
          }

          if (event.type === "error") {
            patchRun(id, (run) => ({
              ...run,
              status: "error",
              stderr: appendOutput(run.stderr, `\n${event.message}`).text,
              durationMs: Math.round(performance.now() - startedAt),
            }));
            continue;
          }

          patchRun(id, (run) => ({
            ...run,
            status: event.status,
            code: event.code,
            signal: event.signal,
            durationMs: event.durationMs,
          }));
        }
      } catch (error) {
        patchRun(id, (run) => ({
          ...run,
          status: "error",
          stderr: appendOutput(run.stderr, `\n${error instanceof Error ? error.message : String(error)}`)
            .text,
          durationMs: Math.round(performance.now() - startedAt),
        }));
      } finally {
        if (activeRunRef.current?.id === id) activeRunRef.current = null;
        busyRef.current = false;
        setStatus("idle");
      }
    },
    [patchRun],
  );

  const requestRun = useCallback(
    (command: KevCommand) => {
      if (command.dangerous) {
        setPendingConfirm(command);
        return;
      }
      void executeCommand(command);
    },
    [executeCommand],
  );

  useKeyboard((key) => {
    if (pendingConfirm) {
      if (key.name === "y") {
        const command = pendingConfirm;
        key.preventDefault();
        setPendingConfirm(null);
        void executeCommand(command);
        return;
      }
      if (!key.ctrl && !key.meta) key.preventDefault();
      setPendingConfirm(null);
      return;
    }

    if (key.name === "escape") {
      key.preventDefault();
      if (activeRunRef.current) {
        activeRunRef.current.controller.abort();
        return;
      }
      if (isPaletteOpen) setDraft("");
      return;
    }

    if (!isPaletteOpen) return;

    if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((index) => Math.max(Math.min(index + 1, matches.length - 1), 0));
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setSelectedIndex((index) => (matches.length === 0 ? 0 : (index + 1) % matches.length));
      return;
    }
    if (key.name === "return") {
      const command = matches[activeIndex];
      if (!command) return;
      key.preventDefault();
      requestRun(command);
    }
  });

  const updateLastAi = (next: UIMessage) => {
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.kind !== "message" || last.message.role !== "assistant") return prev;
      return [...prev.slice(0, -1), messageEntry(next)];
    });
  };

  const handleSubmit = async () => {
    const prompt = draft.trim();
    if (!prompt || busyRef.current) return;
    busyRef.current = true;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: prompt, state: "done" }],
    };
    const assistantMsg: UIMessage = { id: crypto.randomUUID(), role: "assistant", parts: [] };

    // Only the chat entries go to the model; command runs stay UI-only.
    const nextEntries: TranscriptEntry[] = [...entries, messageEntry(userMsg)];
    setEntries([...nextEntries, messageEntry(assistantMsg)]);
    setDraft("");
    setThinkingVerb((previous) => pickVerb(previous));
    setStatus("streaming");

    try {
      const result = await streamAssistantResponse(chatMessages(nextEntries));

      for await (const uiMessage of readUIMessageStream({
        stream: toUIMessageStream({ stream: result.stream }),
        message: assistantMsg,
        terminateOnError: true,
      })) {
        updateLastAi(uiMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateLastAi({
        ...assistantMsg,
        parts: [{ type: "text", text: `Error: ${message}`, state: "done" }],
      });
    } finally {
      busyRef.current = false;
      setStatus("idle");
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor="#000000">
      <box flexGrow={1}>
        {entries.length === 0 ? (
          <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <AsciiBanner font="block" />
            <text fg="#7A8A80" marginTop={2}>
              Your terminal AI assistant — ask Kev to craft a command.
            </text>
          </box>
        ) : (
          <scrollbox width="100%" height="100%" stickyScroll stickyStart="bottom">
          {entries.map((entry) => (
            <EntryView key={entry.id} entry={entry} />
          ))}
          {status === "streaming" ? (
            <box flexDirection="row" marginBottom={1}>
              <Spinner />
              <text attributes={TextAttributes.ITALIC} fg={"#7A8A80"}> {thinkingVerb}…</text>
            </box>
          ) : null}
          </scrollbox>
        )}
      </box>
      <box position="relative" flexShrink={0}>
        {isPaletteOpen ? (
          <CommandPalette
            commands={matches}
            totalCount={commands.length}
            selectedIndex={activeIndex}
            errors={loadErrors}
            confirm={pendingConfirm ? { command: pendingConfirm } : null}
            onSelect={requestRun}
          />
        ) : null}
        <box border borderStyle="rounded" borderColor="#232323" height={3}>
          <input
            focused
            width="100%"
            value={draft}
            onInput={setDraft}
            placeholder="Ask Kev to create a command or type '/' to search"
            onSubmit={handleSubmit}
          />
        </box>
      </box>
    </box>
  );
}
