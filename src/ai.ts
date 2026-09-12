import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";

export const SYSTEM_PROMPT = `You are Kev, an AI assistant embedded in a CLI development tool. You help users build commands for their CLI applications.

Rules:
- Provide complete, ready-to-run commands. Never ask the user to fill in placeholders if you can infer sensible defaults.
- Keep responses tight and actionable.
- When a request involves multiple changes, present them as a short bulleted list.
- Use markdown: fenced code blocks for commands, inline code for flags and names, headings sparingly.`;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function streamAssistantResponse(messages: ChatMessage[]) {
  return streamText({
    model: groq("openai/gpt-oss-20b"),
    system: SYSTEM_PROMPT,
    messages,
  });
}