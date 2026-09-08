import { useState } from "react";
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";

function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexGrow={1}>
        <box width={"100%"} height={"100%"}  justifyContent="center" alignItems="center">
          <ascii-font font="tiny" text="Kev" />
          <text attributes={TextAttributes.DIM}></text>
          <text attributes={TextAttributes.DIM}>Ask Kev to create a command or type '/' to search and run commands</text>
        </box>
      </box>
      <box border borderStyle="rounded" borderColor="#232323" height={3}>
        <input
          focused
          width={"100%"}
          value={draft}
          onInput={setDraft}
          placeholder="Type a message..."
          onSubmit={() => {
            setMessages((prev) => [...prev, draft]);
            setDraft("");
          }}
        />
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
