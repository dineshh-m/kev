import { useState } from "react";
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { streamAssistantResponse, type ChatMessage } from "./ai";
import { AiMessage } from "./components/AiMessage";
import { Spinner } from "./components/Spinner";
import { UserMessage } from "./components/UserMessage";
import type { AiMessage as AiMessageType, Message } from "./types";
import type { JSONValue, ToolCallPart, ToolResultPart } from "ai";

const ARGS_PREVIEW_LIMIT = 60;

function resultSummary(toolName: string, output: unknown): string {
  const record = output as Record<string, unknown>;
  if (toolName === "readFile") {
    const lines = typeof record.totalLines === "number" ? record.totalLines : "?";
    const bytes = typeof record.sizeBytes === "number" ? record.sizeBytes : 0;
    return `${lines} lines · ${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (toolName === "listFiles" && Array.isArray(record.entries)) {
    return `${record.entries.length} entries`;
  }
  const text = JSON.stringify(output);
  return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT)}…` : text;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const updateAiMessage = (fn: (message: AiMessageType) => AiMessageType) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "ai") return prev;
      return [...prev.slice(0, -1), fn(last)];
    });
  };

  const handleSubmit = async () => {
    const prompt = draft.trim();
    if (!prompt || isStreaming) return;

    const nextHistory: ChatMessage[] = [...history, { role: "user", content: prompt }];
    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt },
      { role: "ai", content: "", streaming: true, toolCalls: [] },
    ]);
    setDraft("");
    setIsStreaming(true);

    const toolParts: { toolCallId: string; toolName: string; input: unknown; output: unknown }[] = [];

    try {
      const { fullStream } = streamAssistantResponse(nextHistory);

      let response = "";
      for await (const part of fullStream) {
        switch (part.type) {
          case "text-delta":
            response += part.text;
            updateAiMessage((message) => ({ ...message, content: response, streaming: true }));
            break;
          case "tool-input-start":
            updateAiMessage((message) => ({
              ...message,
              toolCalls: [
                ...message.toolCalls,
                { id: part.id, name: part.toolName, argsText: "", status: "running" },
              ],
            }));
            break;
          case "tool-input-delta": {
            const delta = part.delta;
            updateAiMessage((message) => ({
              ...message,
              toolCalls: message.toolCalls.map((tool) =>
                tool.id === part.id ? { ...tool, argsText: tool.argsText + delta } : tool,
              ),
            }));
            break;
          }
          case "tool-call":
            updateAiMessage((message) => ({
              ...message,
              toolCalls: message.toolCalls.map((tool) =>
                tool.id === part.toolCallId
                  ? {
                      ...tool,
                      args: part.input as Record<string, unknown>,
                      argsText: JSON.stringify(part.input, null, 2),
                    }
                  : tool,
              ),
            }));
            break;
          case "tool-result":
            toolParts.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
              output: part.output,
            });
            updateAiMessage((message) => ({
              ...message,
              toolCalls: message.toolCalls.map((tool) =>
                tool.id === part.toolCallId
                  ? { ...tool, status: "done", result: resultSummary(part.toolName, part.output) }
                  : tool,
              ),
            }));
            break;
          case "tool-error": {
            const error = part.error instanceof Error ? part.error.message : String(part.error);
            updateAiMessage((message) => ({
              ...message,
              toolCalls: message.toolCalls.map((tool) =>
                tool.id === part.toolCallId ? { ...tool, status: "error", error } : tool,
              ),
            }));
            break;
          }
          case "error":
            throw part.error;
        }
      }
      updateAiMessage((message) => ({ ...message, content: response, streaming: false }));

      const toolCallParts: ToolCallPart[] = toolParts.map((tool) => ({
        type: "tool-call",
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        input: tool.input,
      }));
      const toolResultParts: ToolResultPart[] = toolParts.map((tool) => ({
        type: "tool-result",
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        output: { type: "json", value: tool.output as JSONValue },
      }));

      setHistory([
        ...nextHistory,
        ...(toolParts.length > 0
          ? [
              { role: "assistant" as const, content: toolCallParts },
              { role: "tool" as const, content: toolResultParts },
            ]
          : []),
        { role: "assistant", content: response },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAiMessage((ai) => ({ ...ai, content: `Error: ${message}`, streaming: false }));
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor="#000000">
      <box flexGrow={1}>
        <scrollbox width="100%" height="100%" stickyScroll stickyStart="bottom">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <UserMessage key={index} content={message.content} />
            ) : (
              <AiMessage key={index} message={message} />
            ),
          )}
          {isStreaming ? (
            <box flexDirection="row" marginBottom={1}>
              <Spinner />
              <text attributes={TextAttributes.ITALIC} fg={"#7A8A80"}> Unleashing…</text>
            </box>
          ) : null}
        </scrollbox>
      </box>
      <box border borderStyle="rounded" borderColor="#232323" height={3}>
        <input
          focused
          width="100%"
          value={draft}
          onInput={setDraft}
          placeholder="Ask Kev to create to create a command or type '/' to search"
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);