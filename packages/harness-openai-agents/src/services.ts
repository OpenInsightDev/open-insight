import { Layer } from "effect";
import { Agent, run } from "@openai/agents";
import * as Core from "@open-insight/core";

export declare const layers: Layer.Layer<Core.Agent.ProviderService | Core.Sandbox.ProviderService>;
