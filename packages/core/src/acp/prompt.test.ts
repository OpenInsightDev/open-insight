import type { PromptCapabilities, PromptRequest } from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Prompt } from "effect/unstable/ai";
import { type Error, toAcpPrompt } from "./index.ts";

const userMessage = (content: ReadonlyArray<Prompt.UserMessagePart>): Prompt.UserMessage =>
  Prompt.userMessage({ content });

const conversionError = (
  message: Prompt.UserMessage,
  promptCapabilities?: PromptCapabilities,
): Effect.Effect<Error, PromptRequest["prompt"]> =>
  toAcpPrompt(message, { promptCapabilities }).pipe(Effect.flip);

it.effect("preserves text blocks and their boundaries", () =>
  Effect.gen(function* () {
    const blocks = yield* toAcpPrompt(
      userMessage([Prompt.textPart({ text: "" }), Prompt.textPart({ text: "  hello  " })]),
    );

    assert.deepStrictEqual(blocks, [
      { type: "text", text: "" },
      { type: "text", text: "  hello  " },
    ]);
  }),
);

it.effect("preserves an empty user message", () =>
  Effect.gen(function* () {
    const blocks = yield* toAcpPrompt(userMessage([]));
    assert.deepStrictEqual(blocks, []);
  }),
);

it.effect("maps URL files to baseline resource links", () =>
  Effect.gen(function* () {
    const blocks = yield* toAcpPrompt(
      userMessage([
        Prompt.filePart({
          data: new URL("https://example.com/files/report%20one.pdf"),
          mediaType: "application/pdf",
        }),
        Prompt.filePart({
          data: new URL("https://example.com/"),
          fileName: "home.html",
          mediaType: "text/html",
        }),
        Prompt.filePart({
          data: new URL("https://assets.example.com/"),
          mediaType: "application/octet-stream",
        }),
        Prompt.filePart({
          data: new URL("data:text/plain;base64,SGk="),
          mediaType: "text/plain",
        }),
      ]),
    );

    assert.deepStrictEqual(blocks, [
      {
        type: "resource_link",
        name: "report one.pdf",
        uri: "https://example.com/files/report%20one.pdf",
        mimeType: "application/pdf",
      },
      {
        type: "resource_link",
        name: "home.html",
        uri: "https://example.com/",
        mimeType: "text/html",
      },
      {
        type: "resource_link",
        name: "assets.example.com",
        uri: "https://assets.example.com/",
        mimeType: "application/octet-stream",
      },
      {
        type: "resource_link",
        name: "data",
        uri: "data:text/plain;base64,SGk=",
        mimeType: "text/plain",
      },
    ]);
  }),
);

it.effect("falls back to the encoded URL path when percent decoding fails", () =>
  Effect.gen(function* () {
    const blocks = yield* toAcpPrompt(
      userMessage([
        Prompt.filePart({
          data: new URL("https://example.com/%E0%A4%A"),
          mediaType: "application/octet-stream",
        }),
      ]),
    );

    assert.strictEqual(blocks[0]?.type === "resource_link" && blocks[0].name, "%E0%A4%A");
  }),
);

it.effect("encodes image bytes when the capability is enabled", () =>
  Effect.gen(function* () {
    const bytes = new Uint8Array([1, 2, 3]);
    const message = userMessage([
      Prompt.filePart({ data: bytes, fileName: "pixel.png", mediaType: "IMAGE/PNG" }),
      Prompt.filePart({ data: new Uint8Array(), mediaType: "image/png" }),
    ]);
    const blocks = yield* toAcpPrompt(message, {
      promptCapabilities: { image: true },
    });

    assert.deepStrictEqual(blocks, [
      {
        type: "image",
        data: "AQID",
        mimeType: "IMAGE/PNG",
      },
      {
        type: "image",
        data: "",
        mimeType: "image/png",
      },
    ]);
    assert.deepStrictEqual(Array.from(bytes), [1, 2, 3]);
  }),
);

it.effect("normalizes raw base64 audio", () =>
  Effect.gen(function* () {
    const blocks = yield* toAcpPrompt(
      userMessage([
        Prompt.filePart({ data: "AQID", fileName: "sound.wav", mediaType: "audio/wav" }),
      ]),
      { promptCapabilities: { audio: true } },
    );

    assert.deepStrictEqual(blocks, [
      {
        type: "audio",
        data: "AQID",
        mimeType: "audio/wav",
      },
    ]);
  }),
);

it.effect("unwraps data URLs into embedded blob resources", () =>
  Effect.gen(function* () {
    const blocks = yield* toAcpPrompt(
      userMessage([
        Prompt.textPart({ text: "context" }),
        Prompt.filePart({
          data: "data:application/pdf;base64,AQI=",
          fileName: "brief.pdf",
          mediaType: "application/pdf",
        }),
      ]),
      { promptCapabilities: { embeddedContext: true } },
    );

    assert.deepStrictEqual(blocks[1], {
      type: "resource",
      resource: {
        uri: "urn:open-insight:prompt-file:1",
        blob: "AQI=",
        mimeType: "application/pdf",
      },
      _meta: {
        "open-insight/fileName": "brief.pdf",
      },
    });
  }),
);

it.effect("rejects optional ACP content when its capability is not enabled", () =>
  Effect.gen(function* () {
    const imageError = yield* conversionError(
      userMessage([Prompt.filePart({ data: new Uint8Array(), mediaType: "image/png" })]),
    );
    const audioError = yield* conversionError(
      userMessage([Prompt.filePart({ data: new Uint8Array(), mediaType: "audio/wav" })]),
      { image: true },
    );
    const embeddedError = yield* conversionError(
      userMessage([
        Prompt.filePart({ data: new Uint8Array(), mediaType: "application/octet-stream" }),
      ]),
      { image: true, audio: true },
    );

    assert.strictEqual(imageError._tag, "AcpError");
    assert.strictEqual(imageError.reason._tag, "AcpPromptError");
    assert.strictEqual(imageError.reason.reason, "capability_not_enabled");
    assert.strictEqual(imageError.reason.capability, "image");
    assert.strictEqual(imageError.message, "ACP prompt part 0 requires the image capability");
    assert.strictEqual(imageError.cause, imageError.reason);
    assert.strictEqual(audioError.reason.capability, "audio");
    assert.strictEqual(embeddedError.reason.capability, "embeddedContext");
  }),
);

it.effect("rejects malformed base64 without returning a partial prompt", () =>
  Effect.gen(function* () {
    const error = yield* conversionError(
      userMessage([
        Prompt.textPart({ text: "must not be returned" }),
        Prompt.filePart({ data: "not base64", mediaType: "image/png" }),
      ]),
      { image: true },
    );

    assert.strictEqual(error.reason.reason, "invalid_base64");
    assert.strictEqual(error.reason.partIndex, 1);
    assert.strictEqual(error.reason.mediaType, "image/png");
    assert.strictEqual(error.message, "ACP prompt part 1 contains invalid base64 data");
  }),
);

it.effect("rejects malformed data URLs and media type mismatches", () =>
  Effect.gen(function* () {
    const malformed = yield* conversionError(
      userMessage([Prompt.filePart({ data: "data:image/png,AQID", mediaType: "image/png" })]),
      { image: true },
    );
    const mismatch = yield* conversionError(
      userMessage([
        Prompt.filePart({ data: "data:image/jpeg;base64,AQID", mediaType: "image/png" }),
      ]),
      { image: true },
    );

    assert.strictEqual(malformed.reason.reason, "invalid_data_url");
    assert.strictEqual(mismatch.reason.reason, "data_url_media_type_mismatch");
  }),
);
