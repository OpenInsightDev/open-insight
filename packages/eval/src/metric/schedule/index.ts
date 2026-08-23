import { Stream, type DateTime } from "effect";
import * as Chart from "#/chart/index.ts";

export type Metric<E, R> = (
  stream: Stream.Stream<DateTime.DateTime>,
) => Stream.Stream<Chart.Points, E, R>;
