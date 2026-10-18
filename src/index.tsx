import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import packageJson from "../package.json";
import { App } from "./App";
import { logError } from "./debug";
import { setTerminalTitle } from "./terminal";

// Flags handled before the TUI takes over the terminal, so they also work in
// scripts and CI. Anything else falls through to the chat UI.
if (process.argv.includes("--version")) {
  console.log(packageJson.version);
  process.exit(0);
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`kev ${packageJson.version} — a terminal AI assistant

Usage:
  kev              Start the chat UI
  kev --version    Print the version and exit
  kev --help       Show this help

The model endpoint is configured in ~/.kev/config.json (KEV_* env vars
override it). See the README for details.`);
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  logError("uncaughtException", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logError("unhandledRejection", error);
});

setTerminalTitle("Kev");

let renderer;
try {
  renderer = await createCliRenderer();
} catch (error) {
  logError("createCliRenderer", error);
  throw error;
}
createRoot(renderer).render(<App />);
