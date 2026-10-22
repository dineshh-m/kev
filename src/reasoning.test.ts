import { describe, expect, test } from "bun:test";
import {
  readUIMessageStream,
  toUIMessageStream,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";

/**
 * The provider's reasoning arrives as a `reasoning-start` / `reasoning-delta` /
 * `reasoning-end` run of stream parts. This pins the shape the UI relies on:
 * the blocks land in `UIMessage.parts` as `{ type: "reasoning" }` parts, in
 * order, before the text they led to.
 */
function streamOf(parts: TextStreamPart<ToolSet>[]): ReadableStream<TextStreamPart<ToolSet>> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

async function readParts(
  stream: ReadableStream<TextStreamPart<ToolSet>>,
): Promise<UIMessage["parts"]> {
  const message: UIMessage = { id: "m1", role: "assistant", parts: [] };
  let latest: UIMessage["parts"] = [];

  for await (const snapshot of readUIMessageStream({
    stream: toUIMessageStream({ stream }),
    message,
  })) {
    latest = snapshot.parts;
  }

  return latest;
}

describe("provider reasoning", () => {
  test("reasoning reaches the UI message as a reasoning part", async () => {
    const parts = await readParts(
      streamOf([
        { type: "reasoning-start", id: "reasoning-0" },
        { type: "reasoning-delta", id: "reasoning-0", text: "I should " },
        { type: "reasoning-delta", id: "reasoning-0", text: "look at the git log." },
        { type: "reasoning-end", id: "reasoning-0" },
        { type: "text-start", id: "txt-0" },
        { type: "text-delta", id: "txt-0", text: "Here you go." },
        { type: "text-end", id: "txt-0" },
      ]),
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]?.type).toBe("reasoning");
    expect(parts[0]?.type === "reasoning" && parts[0].text).toBe("I should look at the git log.");
    expect(parts[0]?.type === "reasoning" && parts[0].state).toBe("done");
    expect(parts[1]?.type).toBe("text");
    expect(parts[1]?.type === "text" && parts[1].text).toBe("Here you go.");
  });

  test("a reasoning block is streaming until its end chunk arrives", async () => {
    const message: UIMessage = { id: "m1", role: "assistant", parts: [] };
    const states: (string | undefined)[] = [];

    for await (const snapshot of readUIMessageStream({
      stream: toUIMessageStream({
        stream: streamOf([
          { type: "reasoning-start", id: "reasoning-0" },
          { type: "reasoning-delta", id: "reasoning-0", text: "thinking" },
          { type: "reasoning-end", id: "reasoning-0" },
        ]),
      }),
      message,
    })) {
      const part = snapshot.parts[0];
      states.push(part?.type === "reasoning" ? part.state : undefined);
    }

    expect(states).toEqual(["streaming", "streaming", "done"]);
  });

  test("reasoning is dropped when the stream is told not to send it", async () => {
    const message: UIMessage = { id: "m1", role: "assistant", parts: [] };
    const stream = streamOf([
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", text: "hidden" },
      { type: "reasoning-end", id: "reasoning-0" },
    ]);

    let latest: UIMessage["parts"] = [];
    for await (const snapshot of readUIMessageStream({
      stream: toUIMessageStream({ stream, sendReasoning: false }),
      message,
    })) {
      latest = snapshot.parts;
    }

    expect(latest).toEqual([]);
  });
});
