import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { MODEL_ID } from "../ai";
import Banner from "./AsciiBanner";

const TAGLINE = "Your terminal AI assistant — ask Kev to craft a command.";
// Tips are padded to the tagline width so every swap measures the same
// width and the framed panel never jumps sideways.
const TIP_WIDTH = TAGLINE.length;

const TIPS = [
  "type / to browse every command you have saved",
  'ask: "make a command that summarizes my last commit"',
  "dangerous commands ask for a y before they run",
  "/new-session starts fresh, /resume-session restores",
  "scripts run locally in this project directory",
] as const;

const TIP_INTERVAL_MS = 4200;

const MODEL_LABEL = MODEL_ID.split("/").pop() ?? MODEL_ID;

function centerPad(value: string): string {
  if (value.length >= TIP_WIDTH) return value;
  const left = Math.floor((TIP_WIDTH - value.length) / 2);
  return " ".repeat(left) + value + " ".repeat(TIP_WIDTH - value.length - left);
}

function shortCwd(): string {
  const home = process.env.HOME ?? "";
  const cwd = process.cwd();
  if (!home) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export function HomeHero({ commandCount }: { commandCount: number }) {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTipIndex((index) => (index + 1) % TIPS.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const tip = TIPS[tipIndex % TIPS.length] ?? TIPS[0] ?? "";
  const status = `${shortCwd()} · ${commandCount} command${commandCount === 1 ? "" : "s"} · ${MODEL_LABEL}`;

  return (
    <box flexDirection="column" alignItems="center" flexShrink={0}>
      <box
        border
        borderStyle="rounded"
        borderColor="#232323"
        backgroundColor="#070707"
        title=" kev "
        titleColor="#4A6352"
        titleAlignment="center"
        flexDirection="column"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <Banner />
        <text fg="#7A8A80" marginTop={1}>
          {TAGLINE}
        </text>
        <text
          fg="#4A6352"
          attributes={TextAttributes.DIM | TextAttributes.ITALIC}
          marginTop={1}
          wrapMode="none"
        >
          {centerPad(tip)}
        </text>
      </box>
      <text fg="#3D5043" attributes={TextAttributes.DIM} marginTop={1}>
        {"⏎ send · / commands · esc cancel"}
      </text>
      {/* No margin here: the pair must fit a 24-row terminal alongside the panel. */}
      <text fg="#3D5043" attributes={TextAttributes.DIM} wrapMode="none">
        {status}
      </text>
    </box>
  );
}
