import { describe, expect, test } from "bun:test";
import { convertToModelMessages, type UIMessage } from "ai";
import type { KevCommand } from "./commands";
import { runCommand, type RunData, type RunEvent } from "./exec";
import { chatMessages, messageEntry, runEntry, type TranscriptEntry } from "./transcript";

function command(script: string, type: KevCommand["type"] = "bash"): KevCommand {
  return {
    name: "secrets",
    description: "A demo command",
    type,
    script,
    dangerous: false,
    params: [],
    path: "/tmp/secrets.md",
  };
}

async function runToCompletion(source: string): Promise<RunData> {
  const events: RunEvent[] = [];
  for await (const event of runCommand(command(source))) events.push(event);

  const last = events.at(-1);
  const exit = last?.type === "exit" ? last : null;
  const text = (stream: "stdout" | "stderr") =>
    events
      .filter((event): event is Extract<RunEvent, { type: "chunk" }> => event.type === "chunk")
      .filter((event) => event.stream === stream)
      .map((event) => event.text)
      .join("");

  return {
    name: "secrets",
    type: "bash",
    status: exit?.status ?? "error",
    stdout: text("stdout"),
    stderr: text("stderr"),
    code: exit?.code ?? null,
    signal: exit?.signal ?? null,
    durationMs: exit?.durationMs ?? 0,
    truncated: false,
  };
}

function say(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text, state: "done" }] };
}

describe("command runs and model context", () => {
  test("a run entry starts out running with empty output", () => {
    const entry = runEntry("run-1", command("echo hi"));
    expect(entry).toMatchObject({ kind: "run", id: "run-1" });
    expect(entry.data).toEqual({
      name: "secrets",
      type: "bash",
      status: "running",
      stdout: "",
      stderr: "",
      code: null,
      signal: null,
      durationMs: 0,
      truncated: false,
    });
  });

  test("runs are not UIMessages, so no data part can be serialized into context", () => {
    const entry = runEntry("run-1", command("echo hi"));
    expect("parts" in entry).toBe(false);
    expect("role" in entry).toBe(false);
  });

  test("real command output reaches the transcript but never the model", async () => {
    const source = "printf 'S3CRET-TOKEN'";
    const run = await runToCompletion(source);
    const entry = { ...runEntry("run-1", command(source)), data: run };
    const prompt = say("scan my env");
    const transcript: TranscriptEntry[] = [messageEntry(prompt), entry];

    // The transcript keeps the output for the person using the app.
    expect(entry.data.stdout).toContain("S3CRET-TOKEN");

    // The model only ever sees the chat messages.
    expect(chatMessages(transcript)).toEqual([prompt]);
    const modelMessages = await convertToModelMessages(chatMessages(transcript));
    expect(modelMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "scan my env" }] },
    ]);
    expect(JSON.stringify(modelMessages)).not.toContain("S3CRET-TOKEN");
  });

  test("stderr is also kept out of model context", async () => {
    const source = "printf 'LEAKED' >&2; exit 1";
    const run = await runToCompletion(source);
    const transcript: TranscriptEntry[] = [
      messageEntry(say("deploy")),
      { ...runEntry("run-2", command(source)), data: run },
    ];

    expect(transcript[1]?.kind === "run" && transcript[1].data.stderr).toContain("LEAKED");
    const modelMessages = await convertToModelMessages(chatMessages(transcript));
    expect(JSON.stringify(modelMessages)).not.toContain("LEAKED");
    expect(JSON.stringify(modelMessages)).not.toContain("secrets");
  });

  test("chatMessages keeps chat order and drops every run", () => {
    const first = say("first");
    const second = say("second");
    const chat = chatMessages([
      messageEntry(first),
      runEntry("run-1", command("true")),
      messageEntry(second),
      runEntry("run-2", command("true")),
    ]);
    expect(chat).toEqual([first, second]);
  });
});