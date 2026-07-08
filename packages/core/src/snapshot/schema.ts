import { Schema } from "effect";
import * as Image from "./image.ts";
import { Instructions } from "./inst.ts";

export const parsedContainerfileFields = {
  image: Image.FromString,
  instructions: Instructions,
};

export const ParsedContainerfile = Schema.Struct(parsedContainerfileFields);
export type ParsedContainerfile = Schema.Schema.Type<typeof ParsedContainerfile>;
