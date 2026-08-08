import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import * as Event from "../src/event/schema.ts";

describe("StreamPart schema", () => {
  it("round-trips an encoded tool-call", () => {
    const input = { type: "tool-call", id: "call_1", name: "bash", params: { cmd: "ls" } };
    const part = Schema.decodeUnknownSync(Event.StreamPart)(input);
    // Events carry parts in their encoded form: no brand, no injected defaults.
    expect(part).toEqual(input);
    const encoded = Schema.encodeSync(Event.StreamPart)(part);
    expect(encoded).toEqual(input);
  });

  it("round-trips an encoded tool-result", () => {
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
    expect(part).toEqual(input);
    const encoded = Schema.encodeSync(Event.StreamPart)(part);
    expect(encoded).toEqual(input);
  });

  it("keeps optional tool-result fields absent when not provided", () => {
    const input = {
      type: "tool-result",
      id: "call_2",
      name: "ReadFile",
      isFailure: false,
      result: "content",
    };
    const part = Schema.decodeUnknownSync(Event.StreamPart)(input) as Record<string, unknown>;
    expect(part).toEqual(input);
    expect("providerExecuted" in part).toBe(false);
    expect("preliminary" in part).toBe(false);
    expect("metadata" in part).toBe(false);
  });

  it("validates streaming variants", () => {
    const text = Schema.decodeUnknownSync(Event.StreamPart)({ type: "text", text: "hi" });
    const start = Schema.decodeUnknownSync(Event.StreamPart)({ type: "text-start", id: "t1" });
    const delta = Schema.decodeUnknownSync(Event.StreamPart)({
      type: "text-delta",
      id: "t1",
      delta: "ell",
    });
    const call = Schema.decodeUnknownSync(Event.StreamPart)({
      type: "tool-call",
      id: "c",
      name: "n",
      params: {},
    });
    expect(text).toEqual({ type: "text", text: "hi" });
    expect(start).toEqual({ type: "text-start", id: "t1" });
    expect(delta).toEqual({ type: "text-delta", id: "t1", delta: "ell" });
    expect(call).toEqual({ type: "tool-call", id: "c", name: "n", params: {} });
  });

  it("round-trips a full TrailStreamEvent in encoded form", () => {
    const part = { type: "tool-result", id: "r", name: "read", isFailure: false, result: "x" };
    const event = Schema.decodeUnknownSync(Event.TrailStreamEvent)({
      _tag: "TrailStreamEvent",
      bench: "b",
      harness: "h",
      task: "t",
      trailIdx: 0,
      part,
    });
    const encoded = Schema.encodeSync(Event.TrailStreamEvent)(event);
    expect(encoded.part).toEqual(part);
  });
});
