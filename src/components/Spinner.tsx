import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

export function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return <text fg="#73D08A">{FRAMES[frame]}</text>;
}