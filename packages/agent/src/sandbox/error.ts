import { Sandbox } from "@open-insight/core";
import { Inspectable } from "effect";

const formatUnknownCause = (cause: unknown): string =>
  cause instanceof globalThis.Error
    ? `${cause.name}: ${cause.message}`
    : Inspectable.toStringUnknown(cause);

export const formatError = (error: unknown): string => {
  if (error instanceof Sandbox.Error) {
    const reason = error.reason;
    if (reason._tag === "SandboxExecError") {
      return `Failed to ${reason.operation}: ${formatUnknownCause(reason.cause)}`;
    }
    return `${reason._tag}: ${Inspectable.toStringUnknown(reason)}`;
  }
  return Inspectable.toStringUnknown(error);
};
