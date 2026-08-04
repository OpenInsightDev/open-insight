import { Agent } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";
import { Cause } from "effect";
import { EvalError } from "./error.ts";

it("renders the complete agent failure chain", () => {
  const root = new globalThis.Error("request failed with status 401");
  const agent = Agent.AgentError.stream(root);
  const error = EvalError.agent(agent);

  assert.strictEqual(error.message, "Agent response stream failed: request failed with status 401");
  assert.strictEqual(error.cause, agent);
  assert.strictEqual(agent.cause, agent.reason);
  assert.strictEqual(agent.reason.cause, root);

  const rendered = Cause.pretty(Cause.fail(error));
  assert.include(rendered, "EvalError: Agent response stream failed");
  assert.include(rendered, "AgentError: Agent response stream failed");
  assert.include(rendered, "StreamError: Agent response stream failed");
  assert.include(rendered, "Error: request failed with status 401");
});
