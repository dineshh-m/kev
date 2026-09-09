import { useState } from "react";
import { createCliRenderer, SyntaxStyle, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";

const syntaxStyle = SyntaxStyle.create();

type Message = {
  role: "user" | "ai";
  content: string;
};

const initialMessages: Message[] = [
  {
    role: "user",
    content: "Create a command to generate a random password",
  },
  {
    role: "ai",
    content: `Here's a plan for a random password generator:

## Steps

1. Add a \`password\` command to the CLI
2. Generate cryptographically-secure random bytes
3. Encode them as base64 and trim to the requested length

\`\`\`ts
function generatePassword(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, length);
}
\`\`\`

Try it out with:

\`\`\`bash
kev password --length 24
\`\`\``,
  },
  {
    role: "user",
    content: "Add a flag to include symbols in the password",
  },
  {
    role: "ai",
    content: `I'll extend \`password\` with a \`--symbols\` flag.

## Changes

- Add a \`--symbols\` boolean flag
- Append a shuffled symbol set when enabled
- Guard against passwords requested longer than the available pool

> Note: batching makes the output more random than allocating one byte per character.`,
  },
];

function App() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexGrow={1}>
        <scrollbox width="100%" height="100%" stickyScroll stickyStart="bottom">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <box key={index} width="100%" paddingLeft={1} marginBottom={1}>
                <text attributes={TextAttributes.DIM}>{message.content}</text>
              </box>
            ) : (
              <box key={index} width="100%" paddingLeft={1} marginBottom={1}>
                <markdown content={message.content} syntaxStyle={syntaxStyle} />
              </box>
            )
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
          onSubmit={() => {
            setMessages((prev) => [...prev, { role: "user", content: draft }]);
            setDraft("");
          }}
        />
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
