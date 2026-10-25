import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { describeError } from "./errors";

function apiError(overrides: {
  message: string;
  statusCode?: number;
  responseBody?: string;
  url?: string;
  cause?: unknown;
}) {
  return new APICallError({
    message: overrides.message,
    url: overrides.url ?? "https://api.example.com/v1/chat/completions",
    requestBodyValues: { model: "test" },
    statusCode: overrides.statusCode,
    responseBody: overrides.responseBody,
    cause: overrides.cause,
  });
}

describe("describeError", () => {
  test("reports the HTTP status, provider message and endpoint", () => {
    const text = describeError(
      apiError({
        message: "Invalid API key",
        statusCode: 401,
        responseBody: '{"error":{"message":"Invalid API key"}}',
      })
    );

    expect(text).toContain("HTTP 401");
    expect(text).toContain("Invalid API key");
    expect(text).toContain("https://api.example.com/v1/chat/completions");
  });

  test("includes a provider response body the message does not cover", () => {
    const text = describeError(
      apiError({
        message: "Bad request",
        statusCode: 400,
        responseBody: '{"error":{"message":"model `tiny` does not exist"}}',
      })
    );

    expect(text).toContain("Bad request");
    expect(text).toContain("https://api.example.com");
    expect(text).toContain("response: {\"error\":{\"message\":\"model `tiny` does not exist\"}}");
  });

  test("keeps the network cause of a connection failure", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    const text = describeError(
      apiError({
        message: "Cannot connect to API: connect ECONNREFUSED 127.0.0.1:11434",
        cause,
      })
    );

    expect(text).toContain("Cannot connect to API");
    expect(text).toContain("ECONNREFUSED");
  });

  test("follows nested causes and labels non-generic errors", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
      code: "ECONNREFUSED",
    });
    const outer = new TypeError("fetch failed", { cause: inner });

    expect(describeError(outer)).toBe(
      "TypeError: fetch failed · connect ECONNREFUSED 127.0.0.1:11434"
    );
  });

  test("appends an error code the message does not mention", () => {
    const error = Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });

    expect(describeError(error)).toBe("request timed out · ETIMEDOUT");
  });

  test("survives a cause cycle", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    (first as Error & { cause?: unknown }).cause = second;

    expect(describeError(first)).toBe("first · second");
  });

  test("formats non-Error values", () => {
    expect(describeError(undefined)).toBe("unknown error");
    expect(describeError("socket hang up")).toBe("socket hang up");
    expect(describeError({ message: "provider exploded" })).toBe("provider exploded");
    expect(describeError({ status: "bad" })).toBe('{"status":"bad"}');
  });

  test("falls back for an unserializable object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(describeError(circular)).toBe("unrecognized error");
  });

  test("collapses whitespace and clips long messages", () => {
    const text = describeError(new Error(`line one\n\nline two ${"x".repeat(1000)}`));

    expect(text.startsWith("line one line two ")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(701);
  });
});
