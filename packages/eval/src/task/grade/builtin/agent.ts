import { Context, Effect, Layer, Schema } from "effect";
import type { Exec } from "../index.ts";
import { Agent } from "@open-insight/core";
import { LanguageModel } from "effect/unstable/ai";

export class AgentGradeService extends Context.Service<
  AgentGradeService,
  {
    grade: <T>(schema: Schema.Schema<T>) => Exec<T>;
  }
>()("AgentGradeService") {
  static layer = Layer.effect(
    this,
    Effect.gen(function* () {
      yield* Agent.ProviderService;

      throw new Error("AgentGradeService is not implemented yet.");
    }),
  );
}

export class ModelGradeService extends Context.Service<
  ModelGradeService,
  {
    grade: <T>(schema: Schema.Schema<T>) => Exec<T>;
  }
>()("ModelGradeService") {
  static layer = Layer.effect(
    this,
    Effect.gen(function* () {
      yield* LanguageModel.LanguageModel;
      throw new Error("ModelGradeService is not implemented yet.");
    }),
  );
}
