import { describe, expect, test } from "bun:test";
import type { KevCommand } from "./commands";
import { DEFAULT_TIMEOUT_MS, interpreterFor, runCommand, type RunEvent } from "./exec";

function command(script: string, type: KevCommand["type"] = "bash"): KevCommand {
  return {
    name: "demo",
    description: "A demo command",
    type,
    script,
    dangerous: false,
    path: "/tmp/demo.md",
  };
}

async function collect(
  script: string,
  type: KevCommand["type"] = "bash",
  options: Parameters<typeof runCommand>[1] = {},
) {
  const events: RunEvent[] = [];
  for await (const event of runCommand(command(script, type), options)) events.push(event);
  return events;
}

function output(events: RunEvent[], stream: "stdout" | "stderr"): string {
  return events
    .filter((event): event is Extract<RunEvent, { type: "chunk" }> => event.type === "chunk")
    .filter((event) => event.stream === stream)
    .map((event) => event.text)
    .join("");
}

describe("interpreterFor", () => {
  test("maps bash to bash -c", () => {
    expect(interpreterFor("bash")).toEqual(["bash", "-c"]);
  });

  test("maps python to python3 -c", () => {
    expect(interpreterFor("python")).toEqual(["python3", "-c"]);
  });
});

describe("runCommand", () => {
  test("captures stdout and reports success", async () => {
    const events = await collect("printf 'hello'");
    expect(output(events, "stdout")).toBe("hello");

    const exit = events.at(-1);
    expect(exit).toMatchObject({ type: "exit", status: "done", code: 0, signal: null });
  });

  test("reports a nonzero exit as failed", async () => {
    const events = await collect("printf 'bad' >&2; exit 3");
    expect(output(events, "stderr")).toBe("bad");
    expect(events.at(-1)).toMatchObject({ type: "exit", status: "failed", code: 3 });
  });

  test("keeps stdout and stderr separate", async () => {
    const events = await collect("printf 'out'; printf 'err' >&2");
    expect(output(events, "stdout")).toBe("out");
    expect(output(events, "stderr")).toBe("err");
  });

  test("streams many lines in more than one chunk", async () => {
    const events = await collect("for i in $(seq 1 500); do echo line-$i; done");
    const text = output(events, "stdout");
    expect(text).toContain("line-1\n");
    expect(text.trimEnd().endsWith("line-500")).toBe(true);
    expect(events.filter((event) => event.type === "chunk").length).toBeGreaterThan(1);
  });

  test("runs python commands", async () => {
    const events = await collect("print('from python')", "python");
    expect(output(events, "stdout").trim()).toBe("from python");
    expect(events.at(-1)).toMatchObject({ type: "exit", status: "done" });
  });

  test("surfaces a traceback from a python command", async () => {
    const events = await collect("raise SystemExit('boom')", "python");
    expect(output(events, "stderr")).toContain("boom");
    expect(events.at(-1)).toMatchObject({ type: "exit", status: "failed", code: 1 });
  });

  test("kills the child on abort and reports cancelled", async () => {
    const controller = new AbortController();
    const events: RunEvent[] = [];

    const pump = (async () => {
      for await (const event of runCommand(command("sleep 30"), { signal: controller.signal })) {
        events.push(event);
      }
    })();

    setTimeout(() => controller.abort(), 50);
    await pump;

    expect(events.at(-1)).toMatchObject({
      type: "exit",
      status: "cancelled",
      signal: "SIGTERM",
    });
  });

  test("honours a short timeout", async () => {
    const events = await collect("sleep 30", "bash", { timeoutMs: 150 });
    expect(events.at(-1)).toMatchObject({ type: "exit", signal: "SIGTERM" });
  });

  test("defaults to a two minute timeout", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });
});
