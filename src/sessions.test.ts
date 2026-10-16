import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isToolUIPart, type UIMessage } from "ai";
import type { KevCommand } from "./commands";
import {
  listSessions,
  loadSession,
  newSessionRecord,
  sanitizeEntries,
  saveSession,
  sessionPath,
  type StoredSession,
} from "./sessions";
import { messageEntry, runEntry, type TranscriptEntry } from "./transcript";

function command(script = "echo hi"): KevCommand {
  return {
    name: "demo",
    description: "A demo command",
    type: "bash",
    script,
    dangerous: false,
    params: [],
    path: "/tmp/demo.md",
  };
}

function userSays(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text, state: "done" }] };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kev-sessions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sessionWith(entries: TranscriptEntry[], overrides: Partial<StoredSession> = {}): StoredSession {
  const base = newSessionRecord("/projects/kev");
  return { ...base, entries, ...overrides };
}

describe("session storage", () => {
  test("save then load round-trips a full transcript", async () => {
    const chat = messageEntry(userSays("scan my env"));
    const runBase = runEntry("run-1", command());
    const run: TranscriptEntry = {
      ...runBase,
      data: { ...runBase.data, status: "done", code: 0, stdout: "S3CRET" },
    };
    const stored = sessionWith([chat, run]);

    await saveSession(stored, dir);
    const loaded = await loadSession(stored.id, dir);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(stored.id);
    expect(loaded?.cwd).toBe("/projects/kev");
    expect(loaded?.entries).toEqual([chat, run]);
  });

  test("a missing session is null, not an error", async () => {
    expect(await loadSession("nope", dir)).toBeNull();
  });

  test("corrupt JSON is null and is skipped by listSessions", async () => {
    await saveSession(sessionWith([messageEntry(userSays("keep me"))]), dir);
    const bad = sessionWith([]);
    await writeFile(sessionPath(bad.id, dir), "{ torn", "utf8");

    expect(await loadSession(bad.id, dir)).toBeNull();
    const listed = await listSessions(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.preview).toBe("keep me");
  });

  test("an unsupported version is rejected but does not sink the listing", async () => {
    const future = sessionWith([messageEntry(userSays("from the future"))], { version: 99 });
    await saveSession(future, dir);
    await saveSession(sessionWith([messageEntry(userSays("normal"))]), dir);

    await expect(loadSession(future.id, dir)).rejects.toThrow("unsupported session version");
    const listed = await listSessions(dir);
    expect(listed.map((entry) => entry.preview)).toEqual(["normal"]);
  });

  test("the atomic write leaves no temp file behind", async () => {
    await saveSession(sessionWith([messageEntry(userSays("hi"))]), dir);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]?.endsWith(".json")).toBe(true);
  });

  test("listSessions is newest-first and carries cwd and a preview", async () => {
    const older = sessionWith([messageEntry(userSays("older question"))], {
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = sessionWith([messageEntry(userSays("newer question"))], {
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    await saveSession(older, dir);
    await saveSession(newer, dir);

    const listed = await listSessions(dir);
    expect(listed.map((entry) => entry.preview)).toEqual(["newer question", "older question"]);
    expect(listed[0]?.cwd).toBe("/projects/kev");
    expect(listed[0]?.entryCount).toBe(1);
    expect(listed[0]?.updatedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  test("empty sessions are never listed", async () => {
    await saveSession(sessionWith([]), dir);
    expect(await listSessions(dir)).toEqual([]);
  });

  test("a session dir that does not exist lists as empty", async () => {
    expect(await listSessions(join(dir, "missing"))).toEqual([]);
  });
});

describe("sanitizeEntries", () => {
  test("a run stuck running becomes cancelled", () => {
    const [entry] = sanitizeEntries([runEntry("run-1", command())]);
    expect(entry?.kind).toBe("run");
    expect(entry?.kind === "run" && entry.data.status).toBe("cancelled");
  });

  test("a finished run is untouched", () => {
    const base = runEntry("run-1", command());
    const done: TranscriptEntry = { ...base, data: { ...base.data, status: "done", code: 0 } };
    expect(sanitizeEntries([done])).toEqual([done]);
  });

  test("a streaming text part settles to done, keeping its text", () => {
    const partial: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "half an answer", state: "streaming" }],
    };
    const [entry] = sanitizeEntries([messageEntry(partial)]);
    expect(entry?.kind === "message" && entry.message.parts).toEqual([
      { type: "text", text: "half an answer", state: "done" },
    ]);
  });

  test("a tool call with no output is dropped; a terminal one is kept", () => {
    const dangling = {
      type: "tool-listFiles",
      toolCallId: "t1",
      state: "input-available",
      input: { dir: "." },
    } as const;
    const finished = {
      type: "tool-listFiles",
      toolCallId: "t2",
      state: "output-available",
      input: { dir: "." },
      output: { entries: ["a.ts"] },
    } as const;
    const message: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "checking", state: "done" },
        dangling,
        finished,
      ],
    };

    const [entry] = sanitizeEntries([messageEntry(message)]);
    expect(entry?.kind === "message" && entry.message.parts).toEqual([
      { type: "text", text: "checking", state: "done" },
      finished,
    ]);
    for (const part of entry?.kind === "message" ? entry.message.parts : []) {
      if (isToolUIPart(part)) expect(part.state).not.toBe("input-available");
    }
  });

  test("user messages pass through unchanged", () => {
    const user = userSays("hello");
    expect(sanitizeEntries([messageEntry(user)])).toEqual([messageEntry(user)]);
  });
});
