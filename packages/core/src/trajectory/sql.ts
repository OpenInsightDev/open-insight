import { Effect, Option, Schema, Stream } from "effect";
import type { Response, Toolkit } from "effect/unstable/ai";
import { Model } from "effect/unstable/schema";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { make } from "./trajectory.ts";
import type { PromptMessageEncoded } from "./trajectory.ts";

export const TrajectoryId = Schema.String.pipe(Schema.brand("TrajectoryId"));
export type TrajectoryId = typeof TrajectoryId.Type;

export class TrajectoryPart extends Model.Class<TrajectoryPart>("TrajectoryPart")({
  id: Model.GeneratedByDb(Schema.Int),
  trajectoryId: TrajectoryId,
  seq: Schema.Int,
  payload: Schema.Unknown,
  createdAt: Model.DateTimeInsertFromDate,
}) {}

const DEFAULT_PAGE_SIZE = 200;

const PageRequest = Schema.Struct({
  trajectoryId: TrajectoryId,
  afterSeq: Schema.Int,
  limit: Schema.Int,
});

export type LoadOptions = Readonly<{
  /** Number of rows fetched per page. Defaults to {@link DEFAULT_PAGE_SIZE}. */
  pageSize?: number;
}>;

export const load = Effect.fn(function* <Toolkits extends ReadonlyArray<Toolkit.Any>>(
  trajectoryId: TrajectoryId,
  options: LoadOptions,
  ...toolkits: Toolkits
) {
  const sql = yield* SqlClient.SqlClient;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  const findPage = SqlSchema.findAll({
    Request: PageRequest,
    Result: TrajectoryPart,
    execute: (request) => sql`
      SELECT * FROM trajectoryParts
      WHERE trajectoryId = ${request.trajectoryId} AND seq > ${request.afterSeq}
      ORDER BY seq ASC
      LIMIT ${request.limit}
    `,
  });

  const pages = Stream.paginate(-1, (afterSeq: number) =>
    findPage({ trajectoryId, afterSeq, limit: pageSize }).pipe(
      Effect.map((rows) => {
        const last = rows.at(-1);
        const next =
          rows.length < pageSize || last === undefined
            ? Option.none<number>()
            : Option.some(last.seq);
        // The payload column is intentionally untyped storage (see
        // `TrajectoryPart`); `trajectory.make` is what actually validates and
        // decodes it into `PromptMessage`s or `Response` parts.
        const payloads = rows.map(
          (row) => row.payload as PromptMessageEncoded[] | Response.AllPartsEncoded,
        );
        return [payloads, next] as const;
      }),
    ),
  );

  return yield* make(pages, ...toolkits);
});
