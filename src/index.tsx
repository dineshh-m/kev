import { useState } from "react";
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { syntaxStyle } from "./theme";
import { streamAssistantResponse } from "./ai";

type Message = {
  role: "user" | "ai";
  content: string;
  streaming?: boolean;
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const handleSubmit = async () => {
    const prompt = draft.trim();
    if (!prompt || isStreaming) return;

    const history: Message[] = [...messages, { role: "user", content: prompt }];
    setMessages([...history, { role: "ai", content: "", streaming: true }]);
    setDraft("");
    setIsStreaming(true);

    try {
      const { textStream } = streamAssistantResponse(
        history.map((m) => ({
          role: m.role === "ai" ? "assistant" : "user",
          content: m.content,
        })),
      );

      let response = "";
      for await (const delta of textStream) {
        response += delta;
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "ai", content: response, streaming: true },
        ]);
      }
      setMessages((prev) => [...prev.slice(0, -1), { role: "ai", content: response }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev.slice(0, -1), { role: "ai", content: `Error: ${message}` }]);
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
              <box
                key={index}
                width="100%"
                paddingLeft={1}
                marginBottom={1}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor="#0e0e0e"
                border={["left"]}
                borderColor="#73D08A"
              >
                <text attributes={TextAttributes.DIM}>{message.content}</text>
              </box>
            ) : (
              <box key={index} width="100%" paddingLeft={1} marginBottom={1}>
                <markdown
                  content={message.content}
                  syntaxStyle={syntaxStyle}
                  streaming={message.streaming ?? false}
                />
              </box>
            ),
          )}
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