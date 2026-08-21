import { Snapshot, type Prompt } from "@open-insight/core/internal";
import { Effect } from "effect";

export interface Task<out Name extends string> {
  readonly name: Name;
  readonly description: string | null;

  readonly snapshot: Snapshot.Template;
  readonly prompt: Prompt.Gen.Options;
}

export type Any = Task<string>;

type Options = Readonly<{
  prompt: Prompt.Gen.Options;
  description?: string | null;
  snapshot?: Snapshot.Template;
}>;

export const make = <Name extends string>(
  name: Name,
  { prompt, description = null, snapshot = Snapshot.Alpine }: Options,
) =>
  Effect.succeed({
    name,
    description,
    snapshot,
    prompt,
  } satisfies Task<Name>);
