import { Schema } from "effect";
import type { Metrics } from "./build.ts";

// export class Bar extends Schema.TaggedClass<Bar>()("Bar", {
//   category: Schema.String,
//   value: Schema.Number,
// }) {}

// export class GroupedBar extends Schema.TaggedClass<GroupedBar>()("GroupedBar", {
//   category: Schema.String,
//   group: Schema.String,
//   value: Schema.Number,
// }) {}

// export class Pie extends Schema.TaggedClass<Pie>()("Pie", {
//   name: Schema.String,
//   value: Schema.Number,
// }) {}

// export class Line extends Schema.TaggedClass<Line>()("Line", {
//   x: Schema.Union([Schema.Number, Schema.String]),
//   y: Schema.Number,
// }) {}

// export class Series extends Schema.TaggedClass<Series>()("Series", {
//   series: Schema.String,
//   x: Schema.Union([Schema.Number, Schema.String]),
//   y: Schema.Number,
// }) {}

// export class Scatter extends Schema.TaggedClass<Scatter>()("Scatter", {
//   x: Schema.Number,
//   y: Schema.Number,
//   size: Schema.optionalKey(Schema.Number),
//   label: Schema.optionalKey(Schema.String),
// }) {}

// export class Radar extends Schema.TaggedClass<Radar>()("Radar", {
//   category: Schema.String,
//   metric: Schema.String,
//   value: Schema.Number,
// }) {}

// // ── Special Charts ──

// export class Heatmap extends Schema.TaggedClass<Heatmap>()("Heatmap", {
//   x: Schema.Union([Schema.String, Schema.Number]),
//   y: Schema.Union([Schema.String, Schema.Number]),
//   value: Schema.Number,
// }) {}

// export class Treemap extends Schema.TaggedClass<Treemap>()("Treemap", {
//   name: Schema.String,
//   value: Schema.Number,
//   parent: Schema.optionalKey(Schema.String),
// }) {}

// export class SankeyLink extends Schema.TaggedClass<SankeyLink>()("SankeyLink", {
//   source: Schema.String,
//   target: Schema.String,
//   value: Schema.Number,
// }) {}

// export class Funnel extends Schema.TaggedClass<Funnel>()("Funnel", {
//   name: Schema.String,
//   value: Schema.Number,
// }) {}

// export class WordCloud extends Schema.TaggedClass<WordCloud>()("WordCloud", {
//   text: Schema.String,
//   value: Schema.Number,
// }) {}

// export class BoxPlot extends Schema.TaggedClass<BoxPlot>()("BoxPlot", {
//   label: Schema.String,
//   value: Schema.Number,
// }) {}

// export class Candlestick extends Schema.TaggedClass<Candlestick>()("Candlestick", {
//   time: Schema.Union([Schema.String, Schema.Number]),
//   value: Schema.Number,
// }) {}

// export class Gauge extends Schema.TaggedClass<Gauge>()("Gauge", {
//   name: Schema.String,
//   value: Schema.Number,
// }) {}

// export class Content extends Schema.TaggedClass<Content>()("Content", {
//   value: Schema.Json,
// }) {}

// export const Chart = Schema.Union([
//   Bar,
//   GroupedBar,
//   Pie,
//   Line,
//   Series,
//   Scatter,
//   Radar,
//   Heatmap,
//   Treemap,
//   SankeyLink,
//   Funnel,
//   WordCloud,
//   BoxPlot,
//   Candlestick,
//   Gauge,
//   Content,
// ]);
// export type Chart = Schema.Schema.Type<typeof Chart>;

const NumOrString = Schema.Union([Schema.Number, Schema.String]);

class DataPointBase extends Schema.TaggedClass<DataPointBase>()("Datapoint", {
  legend: Schema.String,
}) {}

export class Area extends DataPointBase.extend<Area>("Area")({
  x: NumOrString,
  y: Schema.Number,
}) {}

export class Line extends DataPointBase.extend<Line>("Line")({
  x: NumOrString,
  y: Schema.Number,
}) {}

export class Bar extends DataPointBase.extend<Bar>("Bar")({
  x: NumOrString,
  y: Schema.Number,
}) {}

export class Scatter extends DataPointBase.extend<Scatter>("Scatter")({
  x: NumOrString,
  y: Schema.Number,
  size: Schema.optionalKey(Schema.Number),
}) {}

export class Pie extends DataPointBase.extend<Pie>("Pie")({
  value: Schema.Number,
}) {}

// restricted by https://recharts.github.io/en-US/api/ComposedChart/
export const Composable = Schema.Union([Area, Line, Bar, Scatter]);
export type Composable = Schema.Schema.Type<typeof Composable>;

export const DataPoint = Schema.Union([Composable, Pie]);
export type DataPoint = Schema.Schema.Type<typeof DataPoint>;

type Input<M extends Metrics> = Partial<{}>;

type Output =
  | DataPoint // single datapoint, or
  | ReadonlyArray<Composable>; // composable datapoints on the same chart

export type Chart<M extends Metrics> = Readonly<{
  title: string;
  description?: string;
  format: (input: Input<M>) => PromiseLike<Output> | Output;
}>;
