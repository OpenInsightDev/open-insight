import { assert, it } from "@effect/vitest";
import { Prompt, Response } from "@open-insight/core/internal";
import { Schema } from "effect";
import type { State } from "../index.ts";
import { makeExec, type ToolTurn } from "./index.ts";

const state = (response: State["response"] = []): State => ({
  trajectory: Prompt.empty,
  prompt: Prompt.empty,
  response,
});

const call = (id: string, name: string) =>
  Response.makePart("tool-call", {
    id,
    name,
    params: {},
    providerExecuted: false,
  });

const result = (id: string, name: string, preliminary = false) =>
  Schema.decodeUnknownSync(Response.AnyToolResultPart)({
    type: "tool-result",
    id,
    name,
    isFailure: false,
    result: { ok: true },
    providerExecuted: false,
    preliminary,
  });

it("records completed tool turns by name and matches concurrent calls by id", () => {
  const seen: Array<ToolTurn> = [];
  const exec = makeExec((toolState, turn) => {
    seen.push(turn);
    return {
      total: Object.values(toolState.toolTurns).reduce(
        (count, toolTurns) => count + toolTurns.length,
        0,
      ),
    };
  });

  const firstCall = call("call-1", "read");
  const secondCall = call("call-2", "write");
  const firstResult = result("call-1", "read");
  const secondResult = result("call-2", "write");

  assert.isNull(exec(state([firstCall]), firstCall, null));
  assert.isNull(exec(state([firstCall, secondCall]), secondCall, null));
  assert.deepStrictEqual(exec(state(), secondResult, null), { total: 1 });
  assert.deepStrictEqual(exec(state(), firstResult, null), { total: 2 });
  assert.deepStrictEqual(
    seen.map(({ call }) => call.id),
    ["call-2", "call-1"],
  );
});

it("ignores preliminary and unmatched results", () => {
  let executions = 0;
  const exec = makeExec(() => ({ executions: ++executions }));
  const toolCall = call("call-1", "read");

  assert.isNull(exec(state(), result("missing", "read"), null));
  assert.isNull(exec(state(), toolCall, null));
  assert.isNull(exec(state(), result("call-1", "read", true), null));
  assert.deepStrictEqual(exec(state(), result("call-1", "read"), null), { executions: 1 });
  assert.isNull(exec(state(), result("call-1", "read"), null));
});

it("discards pending calls when a new prompt starts", () => {
  let executed = false;
  const exec = makeExec(() => {
    executed = true;
    return {};
  });
  const toolCall = call("call-1", "read");

  assert.isNull(exec(state(), toolCall, null));
  assert.isNull(exec(state(), Prompt.empty, null));
  assert.isNull(exec(state(), result("call-1", "read"), null));
  assert.isFalse(executed);
});
