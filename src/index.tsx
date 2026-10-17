import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { logError } from "./debug";

process.on("uncaughtException", (error) => {
  logError("uncaughtException", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logError("unhandledRejection", error);
});

let renderer;
try {
  renderer = await createCliRenderer();
} catch (error) {
  logError("createCliRenderer", error);
  throw error;
}
createRoot(renderer).render(<App />);
