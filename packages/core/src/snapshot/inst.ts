import { Schema } from "effect";

export const Instruction = Schema.TaggedUnion({
  Workdir: {
    path: Schema.String,
  },
  User: {
    /**
     * Accepts either `"user"` or `"user:group"`.
     */
    user: Schema.String,
  },
  Run: {
    cmd: Schema.String,
  },
  Env: {
    env: Schema.Record(Schema.String, Schema.String),
  },
  Copy: {
    src: Schema.Array(Schema.String),
    dest: Schema.String,
  },
});
export type Instruction = Schema.Schema.Type<typeof Instruction>;

export const workdir = (workdir: string): Instruction =>
  Instruction.make({ _tag: "Workdir", path: workdir });

export const user = (user: string): Instruction => Instruction.make({ _tag: "User", user });

export const run = (cmd: string): Instruction => Instruction.make({ _tag: "Run", cmd });

export const assert = (...cmd: string[]): Instruction =>
  Instruction.make({ _tag: "Run", cmd: cmd.join(" && ") + " || exit 1" });

export const available = (...program: string[]): Instruction =>
  assert(...program.map((p) => `command -v ${p}`));

export const env = (env: Record<string, string>): Instruction =>
  Instruction.make({ _tag: "Env", env });

export const copy = (src: string[], dest: string): Instruction =>
  Instruction.make({ _tag: "Copy", src, dest });

export const Instructions = Schema.Array(Instruction);
export type Instructions = Schema.Schema.Type<typeof Instructions>;

export const make = (...instructions: Instruction[]): Instructions =>
  Instructions.make(instructions);
