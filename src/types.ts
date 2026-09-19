export type ToolStatus = "running" | "done" | "error";

export type ToolCall = {
  id: string;
  name: string;
  argsText: string;
  args?: Record<string, unknown>;
  status: ToolStatus;
  result?: string;
  error?: string;
};

export type Message =
  | { role: "user"; content: string }
  | { role: "ai"; content: string; streaming?: boolean; toolCalls: ToolCall[] };

export type AiMessage = Extract<Message, { role: "ai" }>;