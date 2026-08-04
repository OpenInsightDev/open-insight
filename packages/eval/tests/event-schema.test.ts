import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import { Response } from "effect/unstable/ai";
import * as Event from "../src/event/schema.ts";

describe("StreamPart schema", () => {
  it("decodes an encoded tool-call into a branded part", () => {
    const input = { type: "tool-call", id: "call_1", name: "bash", params: { cmd: "ls" } };
    const part = Schema.decodeUnknownSync(Event.StreamPart)(input);
    expect(Response.isPart(part)).toBe(true);
    expect(part.type).toBe("tool-call");
    if (part.type === "tool-call") {
      expect(part.name).toBe("bash");
      expect(part.providerExecuted).toBe(false);
      expect(part.metadata).toEqual({});
    }
    const encoded = Schema.encodeSync(Event.StreamPart)(part);
    expect(encoded).toEqual({
      type: "tool-call",
      id: "call_1",
      name: "bash",
      params: { cmd: "ls" },
      providerExecuted: false,
      metadata: {},
    });
  });

  it("decodes an encoded tool-result into a branded part", () => {
    const input = {
      type: "tool-result",
      id: "call_1",
      name: "bash",
      isFailure: false,
      result: { stdout: "src" },
      providerExecuted: true,
      preliminary: false,
      metadata: { ln: { x: 1 } },
    };
    const part = Schema.decodeUnknownSync(Event.StreamPart)(input);
    expect(Response.isPart(part)).toBe(true);
    expect(part.type).toBe("tool-result");
    if (part.type === "tool-result") {
      expect(part.encodedResult).toEqual(part.result);
      expect(part.isFailure).toBe(false);
    }
    const encoded = Schema.encodeSync(Event.StreamPart)(part);
    expect(encoded).toEqual(input);
  });

  it("decodes tool-result with missing optional fields", () => {
    const part = Schema.decodeUnknownSync(Event.StreamPart)({
      type: "tool-result",
      id: "call_2",
      name: "ReadFile",
      isFailure: false,
      result: "content",
    });
    expect(Response.isPart(part)).toBe(true);
    if (part.type === "tool-result") {
      expect(part.providerExecuted).toBe(false);
      expect(part.preliminary).toBe(false);
      expect(part.metadata).toEqual({});
      expect(part.encodedResult).toBe("content");
    }
  });

  it("is consistent with text parts", () => {
    const text = Schema.decodeUnknownSync(Event.StreamPart)({ type: "text", text: "hi" });
    const call = Schema.decodeUnknownSync(Event.StreamPart)({
      type: "tool-call",
      id: "c",
      name: "n",
      params: {},
    });
    expect(Response.isPart(text)).toBe(true);
    expect(Response.isPart(call)).toBe(true);
  });

  it("round-trips a full TrailStreamEvent", () => {
    const event = Schema.decodeUnknownSync(Event.TrailStreamEvent)({
      _tag: "TrailStreamEvent",
      bench: "b",
      harness: "h",
      task: "t",
      trailIdx: 0,
      part: { type: "tool-result", id: "r", name: "read", isFailure: false, result: "x" },
    });
    const encoded = Schema.encodeSync(Event.TrailStreamEvent)(event);
    expect(encoded.part).toEqual({
      type: "tool-result",
      id: "r",
      name: "read",
      isFailure: false,
      result: "x",
      providerExecuted: false,
      metadata: {},
      preliminary: false,
    });
  });
});
