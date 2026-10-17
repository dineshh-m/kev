import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { readUIMessageStream, toUIMessageStream, type UIMessage } from "ai";
import { streamAssistantResponse } from "./ai";
import {
  BUILTIN_COMMANDS,
  isBuiltinCommand,
  type BuiltinName,
  type PaletteCommand,
} from "./builtins";
import { filterCommands, loadCommands, type KevCommand } from "./commands";
import { logError } from "./debug";
import { runCommand, type RunData } from "./exec";
import {
  listSessions,
  loadSession,
  newSessionRecord,
  saveSession,
  type SessionSummary,
  type StoredSession,
} from "./sessions";
import {
  chatMessages,
  messageEntry,
  runEntry,
  type TranscriptEntry,
} from "./transcript";
import { AiMessage } from "./components/AiMessage";
import { CommandPalette } from "./components/CommandPalette";
import { CommandDetail } from "./components/CommandDetail";
import { CommandRun } from "./components/CommandRun";
import { HomeHero } from "./components/HomeHero";
import { ParamForm } from "./components/ParamForm";
import { SessionPicker } from "./components/SessionPicker";
import { Spinner } from "./components/Spinner";
import { UserMessage } from "./components/UserMessage";

const SLASH_QUERY = /^\/(\S*)$/;
const OUTPUT_CHAR_BUDGET = 256 * 1024;
const OUTPUT_MAX_LINES = 200;
const SAVE_DEBOUNCE_MS = 250;

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
  const [pendingConfirm, setPendingConfirm] = useState<{
    command: KevCommand;
    values: Record<string, string>;
  } | null>(null);
  const [pendingParams, setPendingParams] = useState<{
    command: KevCommand;
    values: string[];
  } | null>(null);
  const [paramFocus, setParamFocus] = useState(0);
  const [paramError, setParamError] = useState<string | null>(null);
  const [thinkingVerb, setThinkingVerb] = useState<string>(() => pickVerb());
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeSessions, setResumeSessions] = useState<SessionSummary[]>([]);
  const [resumeIndex, setResumeIndex] = useState(0);
  // Read-only detail overlay for the palette entry under the cursor (ctrl+k).
  const [viewDetail, setViewDetail] = useState<PaletteCommand | null>(null);
  const [detailScroll, setDetailScroll] = useState(0);

  const activeRunRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  // The disk identity of the transcript on screen: saves append `entries`
  // under this id, `new-session` rotates it, `resume-session` adopts an
  // older one.
  const sessionRef = useRef<StoredSession>(newSessionRecord());
  // Saves are chained so two overlapping flushes can never land on disk out
  // of order; the debounce only coalesces how often they are queued. The
  // latest scheduled snapshot is kept in a ref so a session rotation can
  // flush it before the transcript it belongs to is replaced.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveRef = useRef<StoredSession | null>(null);
  // Bumped whenever the transcript is replaced (new-session). In-flight work
  // captures the value it started under and only writes back if it still
  // matches, so an aborted run/stream cannot dirty the fresh session.
  const sessionEpochRef = useRef(0);
  // Authority for "is something already in flight". `status` mirrors it for
  // rendering but state updates are not visible until the next render, so a
  // held-down Enter could otherwise start a second run.
  const busyRef = useRef(false);

  const slashMatch = SLASH_QUERY.exec(draft);
  const isPaletteOpen = slashMatch !== null;
  const query = slashMatch?.[1] ?? null;
  const matches = useMemo(
    () => (query === null ? [] : filterCommands([...BUILTIN_COMMANDS, ...commands], query)),
    [commands, query],
  );
  const activeIndex = Math.min(selectedIndex, Math.max(matches.length - 1, 0));

  const refreshCommands = useCallback(() => {
    void loadCommands()
      .then((result) => {
        setCommands(result.commands);
        setLoadErrors(result.errors);
      })
      .catch((error) => logError("loadCommands", error));
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

  const flushSave = useCallback(() => {
    const snapshot = pendingSaveRef.current;
    if (!snapshot) return;
    pendingSaveRef.current = null;
    saveChainRef.current = saveChainRef.current
      .then(() => saveSession(snapshot))
      .catch((error) => logError("saveSession", error));
  }, []);

  // Persist the transcript under the current session id. Skipped while empty
  // so merely starting Kev never creates a file; `saveSession` writes via a
  // temp file + rename, so a crash mid-write cannot tear the session.
  useEffect(() => {
    if (entries.length === 0) return;
    pendingSaveRef.current = {
      ...sessionRef.current,
      entries,
      updatedAt: new Date().toISOString(),
    };
    const timer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [entries, flushSave]);

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
    async (command: KevCommand, values: Record<string, string>) => {
      if (busyRef.current) return;
      busyRef.current = true;

      const epoch = sessionEpochRef.current;
      const id = crypto.randomUUID();
      const controller = new AbortController();
      const startedAt = performance.now();
      activeRunRef.current = { id, controller };

      setEntries((prev) => [...prev, runEntry(id, command)]);
      setDraft("");
      setPendingConfirm(null);
      setStatus("running");

      try {
        for await (const event of runCommand(command, { signal: controller.signal, params: values })) {
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
            logError(`run:${command.name}`, event.message);
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
        logError(`run:${command.name}`, error);
        patchRun(id, (run) => ({
          ...run,
          status: "error",
          stderr: appendOutput(run.stderr, `\n${error instanceof Error ? error.message : String(error)}`)
            .text,
          durationMs: Math.round(performance.now() - startedAt),
        }));
      } finally {
        // A new session already reset this state; leave its work alone.
        if (sessionEpochRef.current !== epoch) return;
        if (activeRunRef.current?.id === id) activeRunRef.current = null;
        busyRef.current = false;
        setStatus("idle");
      }
    },
    [patchRun],
  );

  // Abort in-flight work and detach the busy latch. The epoch bump makes any
  // still-running loop notice it belongs to an old session and stop writing.
  const clearInFlight = useCallback(() => {
    sessionEpochRef.current += 1;
    activeRunRef.current?.controller.abort();
    activeRunRef.current = null;
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    busyRef.current = false;
  }, []);

  const resetOverlays = useCallback(() => {
    setDraft("");
    setPendingConfirm(null);
    setPendingParams(null);
    setParamError(null);
    setParamFocus(0);
    setSelectedIndex(0);
    setStatus("idle");
    setViewDetail(null);
    setDetailScroll(0);
  }, []);

  const startNewSession = useCallback(() => {
    flushSave();
    clearInFlight();
    sessionRef.current = newSessionRecord();
    setEntries([]);
    resetOverlays();
    setResumeOpen(false);
  }, [clearInFlight, flushSave, resetOverlays]);

  const openResume = useCallback(() => {
    setDraft("");
    setResumeIndex(0);
    setResumeOpen(true);
    void listSessions()
      .then(setResumeSessions)
      .catch((error) => {
        logError("listSessions", error);
        setResumeSessions([]);
      });
  }, []);

  const applyResume = useCallback(
    async (summary: SessionSummary) => {
      let session: StoredSession | null = null;
      try {
        session = await loadSession(summary.id);
      } catch (error) {
        logError(`loadSession:${summary.id}`, error);
        session = null;
      }
      setResumeOpen(false);
      if (!session) return;
      flushSave();
      clearInFlight();
      sessionRef.current = session;
      setEntries(session.entries);
      resetOverlays();
    },
    [clearInFlight, flushSave, resetOverlays],
  );

  const runBuiltin = useCallback(
    (name: BuiltinName) => {
      if (name === "new-session") startNewSession();
      if (name === "resume-session") openResume();
    },
    [openResume, startNewSession],
  );

  const proceed = useCallback(
    (command: KevCommand, values: Record<string, string>) => {
      if (command.dangerous) {
        setPendingConfirm({ command, values });
        return;
      }
      void executeCommand(command, values);
    },
    [executeCommand],
  );

  const requestRun = useCallback(
    (command: PaletteCommand) => {
      if (isBuiltinCommand(command)) {
        runBuiltin(command.name);
        return;
      }
      if (command.params.length > 0) {
        setPendingParams({
          command,
          values: command.params.map((param) => param.default ?? ""),
        });
        setParamFocus(0);
        setParamError(null);
        setDraft("");
        return;
      }
      proceed(command, {});
    },
    [proceed, runBuiltin],
  );

  const updateParam = useCallback((index: number, value: string) => {
    setPendingParams((prev) => {
      if (!prev) return prev;
      const values = [...prev.values];
      values[index] = value;
      return { ...prev, values };
    });
    setParamError(null);
  }, []);

  const submitParams = useCallback(
    (request: { command: KevCommand; values: string[] }) => {
      const missing = request.command.params.find(
        (param, index) => param.required && (request.values[index] ?? "").trim() === "",
      );
      if (missing) {
        setParamError(`"${missing.description?.trim() || missing.name}" is required`);
        return;
      }

      const values = Object.fromEntries(
        request.command.params.map((param, index) => [
          param.name,
          request.values[index] ?? param.default ?? "",
        ]),
      );
      setPendingParams(null);
      setParamError(null);
      proceed(request.command, values);
    },
    [proceed],
  );

  const handleParamSubmit = useCallback(
    (index: number) => {
      if (!pendingParams) return;
      if (index < pendingParams.command.params.length - 1) {
        setParamFocus(index + 1);
        setParamError(null);
        return;
      }
      submitParams(pendingParams);
    },
    [pendingParams, submitParams],
  );

  useKeyboard((key) => {
    if (pendingConfirm) {
      if (key.name === "y") {
        const { command, values } = pendingConfirm;
        key.preventDefault();
        setPendingConfirm(null);
        void executeCommand(command, values);
        return;
      }
      if (!key.ctrl && !key.meta) key.preventDefault();
      setPendingConfirm(null);
      return;
    }

    if (pendingParams) {
      const count = pendingParams.command.params.length;
      const move = (delta: number) => {
        key.preventDefault();
        setParamFocus((index) => (index + delta + count) % count);
        setParamError(null);
      };

      if (key.name === "escape") {
        key.preventDefault();
        setPendingParams(null);
        setParamError(null);
        return;
      }
      if (key.name === "tab") {
        move(key.shift ? -1 : 1);
        return;
      }
      if (key.name === "up") {
        move(-1);
        return;
      }
      if (key.name === "down") {
        move(1);
        return;
      }
      // Enter is left to the focused input's onSubmit so it advances or runs.
      return;
    }

    if (resumeOpen) {
      if (key.name === "escape") {
        key.preventDefault();
        setResumeOpen(false);
        return;
      }
      if (resumeSessions.length === 0) {
        if (!key.ctrl && !key.meta) key.preventDefault();
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        setResumeIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        setResumeIndex((index) => Math.min(index + 1, resumeSessions.length - 1));
        return;
      }
      if (key.name === "return") {
        key.preventDefault();
        const picked = resumeSessions[Math.min(resumeIndex, resumeSessions.length - 1)];
        if (picked) void applyResume(picked);
        return;
      }
      if (!key.ctrl && !key.meta) key.preventDefault();
      return;
    }

    if (viewDetail) {
      if (key.name === "escape" || (key.ctrl && key.name === "k")) {
        key.preventDefault();
        setViewDetail(null);
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        setDetailScroll((offset) => Math.max(offset - 1, 0));
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        setDetailScroll((offset) => offset + 1);
        return;
      }
      if (!key.ctrl && !key.meta) key.preventDefault();
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

    if (key.ctrl && key.name === "k") {
      key.preventDefault();
      const command = matches[activeIndex];
      if (command) {
        setDetailScroll(0);
        setViewDetail(command);
      }
      return;
    }

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

    const epoch = sessionEpochRef.current;
    const controller = new AbortController();
    streamControllerRef.current = controller;

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
      const result = await streamAssistantResponse(chatMessages(nextEntries), controller.signal);

      for await (const uiMessage of readUIMessageStream({
        stream: toUIMessageStream({ stream: result.stream }),
        message: assistantMsg,
        terminateOnError: true,
      })) {
        if (sessionEpochRef.current !== epoch) break;
        updateLastAi(uiMessage);
      }
    } catch (error) {
      // A new session aborts the stream; its rejection is not an error to show.
      if (sessionEpochRef.current === epoch) {
        logError("streamAssistantResponse", error);
        const message = error instanceof Error ? error.message : String(error);
        updateLastAi({
          ...assistantMsg,
          parts: [{ type: "text", text: `Error: ${message}`, state: "done" }],
        });
      }
    } finally {
      if (streamControllerRef.current === controller) streamControllerRef.current = null;
      if (sessionEpochRef.current === epoch) {
        busyRef.current = false;
        setStatus("idle");
      }
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor="#000000">
      <box flexGrow={1}>
        {entries.length === 0 ? (
          <box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <HomeHero commandCount={BUILTIN_COMMANDS.length + commands.length} />
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
        {isPaletteOpen && !viewDetail ? (
          <CommandPalette
            commands={matches}
            totalCount={BUILTIN_COMMANDS.length + commands.length}
            selectedIndex={activeIndex}
            errors={loadErrors}
            confirm={pendingConfirm ? { command: pendingConfirm.command } : null}
            onSelect={requestRun}
          />
        ) : null}
        {viewDetail ? <CommandDetail command={viewDetail} scroll={detailScroll} /> : null}
        {pendingParams ? (
          <ParamForm
            command={pendingParams.command}
            values={pendingParams.values}
            focusedIndex={paramFocus}
            error={paramError}
            onChange={updateParam}
            onSubmit={handleParamSubmit}
          />
        ) : null}
        {resumeOpen ? (
          <SessionPicker
            sessions={resumeSessions}
            selectedIndex={Math.min(resumeIndex, Math.max(resumeSessions.length - 1, 0))}
            onSelect={(session) => void applyResume(session)}
          />
        ) : null}
        <box border borderStyle="rounded" borderColor="#232323" height={3}>
          <input
            focused={pendingParams === null && !resumeOpen && viewDetail === null}
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
