import { Prompt } from "effect/unstable/ai";
import { Model } from "effect/unstable/schema";
import { Schema } from "effect";

export class PromptModel extends Model.Class<PromptModel>("PromptModel")({
  id: Model.GeneratedByDb(Schema.Int),
  message: Prompt.Message,
}) {}
