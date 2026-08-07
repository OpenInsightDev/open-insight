export {
  ContainerfileTemplate,
  InstructionsTemplate,
  Template,
  Image,
  FromString,
  encode,
  extend,
  build,
  hash,
  isContainerfile,
  isInstructions,
  makeTemplate,
  makeTemplateWith,
  Scratch,
  writeInstructions,
  type MakeOptions,
} from "./template.ts";
export {
  BuildError,
  DeriveError,
  SnapshotError,
  ErrorReason,
  InstructionUnsupported,
  UseError,
} from "./error.ts";

export * from "./inst.ts";
export * as Internal from "./index.ts";
