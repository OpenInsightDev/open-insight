import { Formatter, Schema } from "effect";

/** The prompt factory or follow-up iterator rejected while producing the next prompt. */
export class GenerateFailed extends Schema.TaggedError<GenerateFailed>(
  "open-insight/PromptError/GenerateFailed",
)("GenerateFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to generate the next prompt: ${Formatter.format(this.cause)}`;
  }
}

/** An Eta template could not be read from disk or rendered with the given data. */
export class TemplateFailed extends Schema.TaggedError<TemplateFailed>(
  "open-insight/PromptError/TemplateFailed",
)("TemplateFailed", {
  filePath: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to load Eta template "${this.filePath}": ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([GenerateFailed, TemplateFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class PromptError extends Schema.TaggedError<PromptError>("open-insight/PromptError")(
  "PromptError",
  {
    reason: ErrorReason,
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static generate = (cause: unknown): PromptError =>
    PromptError.make({ reason: GenerateFailed.make({ cause }) });

  static template =
    (filePath: string) =>
    (cause: unknown): PromptError =>
      PromptError.make({ reason: TemplateFailed.make({ filePath, cause }) });
}
