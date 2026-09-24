import { useState } from "react";
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { readUIMessageStream, toUIMessageStream, type UIMessage } from "ai";
import { streamAssistantResponse } from "./ai";
import { AiMessage } from "./components/AiMessage";
import { AsciiBanner } from "./components/AsciiBanner";
import { Spinner } from "./components/Spinner";
import { UserMessage } from "./components/UserMessage";

function userText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const updateLastAi = (next: UIMessage) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), next];
    });
  };

  const handleSubmit = async () => {
    const prompt = draft.trim();
    if (!prompt || isStreaming) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: prompt, state: "done" }],
    };
    const assistantMsg: UIMessage = { id: crypto.randomUUID(), role: "assistant", parts: [] };

    const nextMessages: UIMessage[] = [...messages, userMsg];
    setMessages([...nextMessages, assistantMsg]);
    setDraft("");
    setIsStreaming(true);

    try {
      const result = await streamAssistantResponse(nextMessages);

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
      setIsStreaming(false);
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor="#000000">
      <box flexGrow={1}>
        {messages.length === 0 ? (
          <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <AsciiBanner font="block" />
            <text fg="#7A8A80" marginTop={2}>
              Your terminal AI assistant — ask Kev to craft a command.
            </text>
          </box>
        ) : (
          <scrollbox width="100%" height="100%" stickyScroll stickyStart="bottom">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <UserMessage key={index} content={userText(message)} />
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
        )}
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