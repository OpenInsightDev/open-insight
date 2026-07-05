import { Schema } from "effect";

// ── Traditional Charts ──

export class Bar extends Schema.TaggedClass<Bar>()("Bar", {
  category: Schema.String,
  value: Schema.Number,
}) {}

export class GroupedBar extends Schema.TaggedClass<GroupedBar>()("GroupedBar", {
  category: Schema.String,
  group: Schema.String,
  value: Schema.Number,
}) {}

export class Pie extends Schema.TaggedClass<Pie>()("Pie", {
  name: Schema.String,
  value: Schema.Number,
}) {}

export class Line extends Schema.TaggedClass<Line>()("Line", {
  x: Schema.Union([Schema.Number, Schema.String]),
  y: Schema.Number,
}) {}

export class Series extends Schema.TaggedClass<Series>()("Series", {
  series: Schema.String,
  x: Schema.Union([Schema.Number, Schema.String]),
  y: Schema.Number,
}) {}

export class Scatter extends Schema.TaggedClass<Scatter>()("Scatter", {
  x: Schema.Number,
  y: Schema.Number,
  size: Schema.optionalKey(Schema.Number),
  label: Schema.optionalKey(Schema.String),
}) {}

export class Radar extends Schema.TaggedClass<Radar>()("Radar", {
  category: Schema.String,
  metric: Schema.String,
  value: Schema.Number,
}) {}

// ── Special Charts ──

export class Heatmap extends Schema.TaggedClass<Heatmap>()("Heatmap", {
  x: Schema.Union([Schema.String, Schema.Number]),
  y: Schema.Union([Schema.String, Schema.Number]),
  value: Schema.Number,
}) {}

export class Treemap extends Schema.TaggedClass<Treemap>()("Treemap", {
  name: Schema.String,
  value: Schema.Number,
  parent: Schema.optionalKey(Schema.String),
}) {}

export class SankeyLink extends Schema.TaggedClass<SankeyLink>()("SankeyLink", {
  source: Schema.String,
  target: Schema.String,
  value: Schema.Number,
}) {}

export class Funnel extends Schema.TaggedClass<Funnel>()("Funnel", {
  name: Schema.String,
  value: Schema.Number,
}) {}

export class WordCloud extends Schema.TaggedClass<WordCloud>()("WordCloud", {
  text: Schema.String,
  value: Schema.Number,
}) {}

export class BoxPlot extends Schema.TaggedClass<BoxPlot>()("BoxPlot", {
  label: Schema.String,
  value: Schema.Number,
}) {}

export class Candlestick extends Schema.TaggedClass<Candlestick>()("Candlestick", {
  time: Schema.Union([Schema.String, Schema.Number]),
  value: Schema.Number,
}) {}

export class Gauge extends Schema.TaggedClass<Gauge>()("Gauge", {
  name: Schema.String,
  value: Schema.Number,
}) {}

export class Content extends Schema.TaggedClass<Content>()("Content", {
  value: Schema.Json,
}) {}

export const Chart = Schema.Union([
  Bar,
  GroupedBar,
  Pie,
  Line,
  Series,
  Scatter,
  Radar,
  Heatmap,
  Treemap,
  SankeyLink,
  Funnel,
  WordCloud,
  BoxPlot,
  Candlestick,
  Gauge,
  Content,
]);
export type Chart = Schema.Schema.Type<typeof Chart>;

export const Type = Schema.Union([
  Schema.Literal("Bar"),
  Schema.Literal("GroupedBar"),
  Schema.Literal("Pie"),
  Schema.Literal("Line"),
  Schema.Literal("Series"),
  Schema.Literal("Scatter"),
  Schema.Literal("Radar"),
  Schema.Literal("Heatmap"),
  Schema.Literal("Treemap"),
  Schema.Literal("SankeyLink"),
  Schema.Literal("Funnel"),
  Schema.Literal("WordCloud"),
  Schema.Literal("BoxPlot"),
  Schema.Literal("Candlestick"),
  Schema.Literal("Gauge"),
  Schema.Literal("Content"),
]);
export type Type = Schema.Schema.Type<typeof Type>;

export type Exec<R = any> = (result: R) => Chart[];

export type Format<N extends string = string, R = unknown> = Readonly<{
  name: N;
  format: Exec<R>;
}>;
