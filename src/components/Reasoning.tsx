import { TextAttributes } from "@opentui/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReasoningUIPart } from "ai";

const BORDER_COLOR = "#4A6352";
const BODY_COLOR = "#7A8A80";
const HINT_COLOR = "#3D5043";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One reasoning block emitted by the provider.
 *
 * The block is live while the model is still thinking: it opens on its own and
 * collapses to a one-line summary when the step ends. Clicking it takes over
 * from that automatic behaviour, so a block the user opened stays open.
 *
 * The duration is only known for a block watched from its first token. A block
 * restored from a saved session was already finished when it mounted, so it
 * shows no duration rather than a made-up one.
 */
export function Reasoning({ part }: { part: ReasoningUIPart }) {
  const streaming = part.state === "streaming";
  // The provider creates the part with its `reasoning-start` chunk, so mounting
  // is the moment this block began.
  const startedAt = useRef(Date.now());
  // Whether this block was ever seen mid-flight, which is what makes its
  // duration measurable.
  const watched = useRef(streaming); // we only calculate duration for watched reasoning parts
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(streaming);
  // Set once the user clicks: from then on their choice wins over the
  // automatic expand/collapse.
  const manual = useRef(false);

  // A layout effect so the summary and the collapse land in the same frame,
  // rather than the header flickering through a duration-less "Thought".
  useLayoutEffect(() => {
    if (streaming) {
      if (!manual.current) setExpanded(true);
      return;
    }
    // if watched calculate duration
    if (watched.current) {
      setDurationMs((current) => current ?? Date.now() - startedAt.current);
    }
    if (!manual.current) setExpanded(false);
  }, [streaming]);

  const toggle = useCallback(() => {
    manual.current = true;
    setExpanded((current) => !current);
  }, []);

  const label = streaming
    ? "✦ Thinking"
    : durationMs === null
      ? "✦ Thought"
      : `✦ Thought · ${formatDuration(durationMs)}`;

  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={BORDER_COLOR}
      paddingLeft={1}
      marginBottom={1}
      onMouseDown={toggle}
    >
      <box flexDirection="row">
        <text fg={BORDER_COLOR}>{label}</text>
        {!streaming && !expanded ? (
          <text fg={HINT_COLOR} attributes={TextAttributes.DIM}>
            {"  click to expand"}
          </text>
        ) : null}
      </box>
      {expanded && part.text.length > 0 ? (
        <text fg={BODY_COLOR} attributes={TextAttributes.DIM} marginTop={1}>
          {part.text}
        </text>
      ) : null}
    </box>
  );
}
