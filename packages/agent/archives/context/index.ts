import { Context, Effect } from "effect";
import { Prompt } from "effect/unstable/ai";

export type Handler = Effect.Effect<Prompt.Prompt, unknown>;

export type MiddlewareOptions = Readonly<{
  prompt: Prompt.Prompt;
  part: Prompt.Part;
}>;

export interface ContextService {
  (handler: Handler, options: MiddlewareOptions): Handler;
}

export interface AnyService extends Context.Key<unknown, ContextService> {}

export const Service = <Self>() => Context.Service<Self, ContextService>();

export const resolve = (services: ReadonlyArray<AnyService>) =>
  Effect.map(Effect.context<never>(), (context) =>
    services.map((service) => Context.getUnsafe(context, service)),
  );

const appendAssistantPart = (prompt: Prompt.Prompt, part: Prompt.AssistantMessagePart) => {
  const last = prompt.content.at(-1);
  if (last?.role === "assistant") {
    return Prompt.fromMessages([
      ...prompt.content.slice(0, -1),
      Prompt.assistantMessage({ content: [...last.content, part], options: last.options }),
    ]);
  }
  return Prompt.concat(prompt, Prompt.fromMessages([Prompt.assistantMessage({ content: [part] })]));
};

const appendToolPart = (prompt: Prompt.Prompt, part: Prompt.ToolMessagePart) => {
  const last = prompt.content.at(-1);
  if (last?.role === "tool") {
    return Prompt.fromMessages([
      ...prompt.content.slice(0, -1),
      Prompt.toolMessage({ content: [...last.content, part], options: last.options }),
    ]);
  }
  return Prompt.concat(prompt, Prompt.fromMessages([Prompt.toolMessage({ content: [part] })]));
};

const append = (prompt: Prompt.Prompt, part: Prompt.Part) =>
  Effect.succeed(
    part.type === "tool-result" || part.type === "tool-approval-response"
      ? appendToolPart(prompt, part)
      : appendAssistantPart(prompt, part),
  );

export const apply = (
  services: ReadonlyArray<ContextService>,
  prompt: Prompt.Prompt,
  part: Prompt.Part,
): Handler => {
  const options: MiddlewareOptions = { prompt, part };
  let handler: Handler = append(prompt, part);
  for (const service of services) {
    handler = service(handler, options);
  }
  return handler;
};
