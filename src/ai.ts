import { streamText, stepCountIs, type AssistantContent, type ToolContent } from "ai";
import { groq } from "@ai-sdk/groq";
import { KevTools } from "./tools";

export const SYSTEM_PROMPT = `You are Kev, an AI assistant embedded in a CLI development tool. You help users build commands for their CLI applications.

You have tools to inspect the local project: readFile and listFiles. Use them to ground your answers in the actual code before suggesting changes.

Rules:
- Provide complete, ready-to-run commands. Never ask the user to fill in placeholders if you can infer sensible defaults.
- Keep responses tight and actionable.
- When a request involves multiple changes, present them as a short bulleted list.
- Use markdown: fenced code blocks for commands, inline code for flags and names, headings sparingly.`;

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | AssistantContent }
  | { role: "tool"; content: ToolContent };

const MAX_STEPS = 20;

export function streamAssistantResponse(messages: ChatMessage[]) {
  return streamText({
    model: groq("openai/gpt-oss-20b"),
    system: SYSTEM_PROMPT,
    tools: KevTools,
    stopWhen: stepCountIs(MAX_STEPS),
    messages,
  });
}