import { useCallback, useEffect, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { readUIMessageStream, toUIMessageStream, type UIMessage } from "ai";
import { streamAssistantResponse } from "./ai";
import { filterCommands, loadCommands, type KevCommand } from "./commands";
import { AiMessage } from "./components/AiMessage";
import { AsciiBanner } from "./components/AsciiBanner";
import { CommandPalette } from "./components/CommandPalette";
import { Spinner } from "./components/Spinner";
import { UserMessage } from "./components/UserMessage";

const SLASH_QUERY = /^\/(\S*)$/;

function userText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [commands, setCommands] = useState<KevCommand[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  const chooseCommand = useCallback((command: KevCommand) => {
    setDraft(`/${command.name}`);
  }, []);

  useKeyboard((key) => {
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
    if (key.name === "escape") {
      key.preventDefault();
      setDraft("");
      return;
    }
    if (key.name === "return") {
      const command = matches[activeIndex];
      if (!command) return;
      key.preventDefault();
      chooseCommand(command);
    }
  });

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
      {isPaletteOpen ? (
        <CommandPalette
          commands={matches}
          totalCount={commands.length}
          selectedIndex={activeIndex}
          errors={loadErrors}
          onSelect={chooseCommand}
        />
      ) : null}
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