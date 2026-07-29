import { NodeSink, NodeStream } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Task from "#/task/index.ts";
import { Error } from "./error.ts";
import type { Load } from "./index.ts";
import { createGunzip, createZstdDecompress } from "node:zlib";
import * as tar from "tar-stream";

const archiveEntryPath = Effect.fn(function* (root: string, entryName: string) {
  const path = yield* Path.Path;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, entryName);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    return yield* Effect.fail(
      Error.source(
        new globalThis.Error(`Archive entry escapes extraction directory: ${entryName}`),
      ),
    );
  }
  return target;
});

const entryStream = (entry: tar.Entry) =>
  NodeStream.fromReadable<Uint8Array, Error>({
    evaluate: () => entry,
    onError: Error.source,
  });

const extractArchive = Effect.fn(function* <R>(
  archive: Stream.Stream<Uint8Array, Error, R>,
  distPath: string,
  format: "tar.gz" | "tar.zst",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const extract = yield* Effect.sync(() => tar.extract());

  const writeArchive = archive.pipe(
    NodeStream.pipeThroughDuplex<Uint8Array, Error>({
      evaluate: () => (format === "tar.zst" ? createZstdDecompress() : createGunzip()),
      onError: Error.source,
    }),
    Stream.run(
      NodeSink.fromWritable({
        evaluate: () => extract,
        onError: Error.source,
      }),
    ),
  );

  const writeEntries = Stream.fromAsyncIterable(extract, Error.source).pipe(
    Stream.mapEffect(
      Effect.fn(function* (entry) {
        const target = yield* archiveEntryPath(distPath, entry.header.name);
        if (entry.header.type === "directory") {
          yield* fs.makeDirectory(target, { recursive: true });
          return yield* entryStream(entry).pipe(Stream.runDrain);
        }

        if (
          entry.header.type === undefined ||
          entry.header.type === null ||
          entry.header.type === "file"
        ) {
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          return yield* entryStream(entry).pipe(Stream.run(fs.sink(target)));
        }

        return yield* entryStream(entry).pipe(Stream.runDrain);
      }),
    ),
    Stream.runDrain,
  );

  yield* Effect.zip(writeArchive, writeEntries, { concurrent: true });
});

export const withDist = ({
  url,
  format = "tar.gz",
}: {
  url: string;
  format?: "tar.gz" | "tar.zst";
}) =>
  Effect.fn(function* <T extends Task.Task, E, R>(
    exec: (options: { distPath: string }) => Load<T, E, R>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const distPath = yield* fs.makeTempDirectoryScoped({ prefix: "open-insight-dist-" });
    const parsedUrl = yield* Schema.decodeUnknownEffect(Schema.URLFromString)(url);
    const archive = HttpClient.get(parsedUrl).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      HttpClientResponse.stream,
      Stream.mapError(Error.source),
    );

    yield* extractArchive(archive, distPath, format);

    const loader = yield* Effect.try({
      try: () => exec({ distPath }),
      catch: Error.init,
    });
    return yield* loader;
  }, Effect.mapError(Error.source));
