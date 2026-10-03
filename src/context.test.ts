import { describe, expect, test } from "bun:test";
import { convertToModelMessages, isDataUIPart, type UIMessage } from "ai";
import type { KevCommand } from "./commands";
import { createRunMessage, runCommand, type RunData, type RunEvent } from "./exec";

function command(script: string, type: KevCommand["type"] = "bash"): KevCommand {
  return {
    name: "secrets",
    description: "A demo command",
    type,
    script,
    dangerous: false,
    path: "/tmp/secrets.md",
  };
}

function partData(message: UIMessage, index: number): unknown {
  const part = message.parts[index];
  if (!part || !isDataUIPart(part)) throw new Error(`part ${index} is not a data part`);
  return part.data;
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

function attach(message: UIMessage, data: RunData): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => (isDataUIPart(part) ? { ...part, data } : part)),
  };
}

describe("command runs and model context", () => {
  test("a run message holds the invocation text and a data-command part", () => {
    const message = createRunMessage("run-1", command("echo hi"));
    expect(message.role).toBe("user");
    expect(message.parts[0]).toMatchObject({ type: "text", text: "/secrets" });
    expect(message.parts[1]).toMatchObject({ type: "data-command" });
  });

  test("real command output reaches the message but never the model", async () => {
    const source = "printf 'S3CRET-TOKEN'";
    const run = await runToCompletion(source);
    const message = attach(createRunMessage("run-1", command(source)), run);

    // The transcript keeps the output for the person using the app.
    expect((partData(message, 1) as RunData).stdout).toContain("S3CRET-TOKEN");

    // The model only ever sees the invocation.
    const modelMessages = await convertToModelMessages([message]);
    expect(modelMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "/secrets" }] },
    ]);
    expect(JSON.stringify(modelMessages)).not.toContain("S3CRET-TOKEN");
  });

  test("stderr is also kept out of model context", async () => {
    const source = "printf 'LEAKED' >&2; exit 1";
    const run = await runToCompletion(source);
    const message = attach(createRunMessage("run-2", command(source)), run);

    expect((partData(message, 1) as RunData).stderr).toContain("LEAKED");
    const modelMessages = await convertToModelMessages([message]);
    expect(JSON.stringify(modelMessages)).not.toContain("LEAKED");
  });

  test("a run message never converts to empty model content", async () => {
    const message = createRunMessage("run-3", command("true"));
    const modelMessages = await convertToModelMessages([message]);
    const [first] = modelMessages;
    expect(first).toBeDefined();
    expect((first?.content as unknown[]).length).toBeGreaterThan(0);
  });
});
