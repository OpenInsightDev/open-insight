import { Schema } from "effect";

// ── Traditional Charts ──

export class BarDataPoint extends Schema.TaggedClass<BarDataPoint>()("BarDataPoint", {
  category: Schema.String,
  value: Schema.Number,
}) {}

export class GroupedBarDataPoint extends Schema.TaggedClass<GroupedBarDataPoint>()(
  "GroupedBarDataPoint",
  {
    category: Schema.String,
    group: Schema.String,
    value: Schema.Number,
  },
) {}

export class PieDataPoint extends Schema.TaggedClass<PieDataPoint>()("PieDataPoint", {
  name: Schema.String,
  value: Schema.Number,
}) {}

export class LineDataPoint extends Schema.TaggedClass<LineDataPoint>()("LineDataPoint", {
  x: Schema.Union([Schema.Number, Schema.String]),
  y: Schema.Number,
}) {}

export class SeriesDataPoint extends Schema.TaggedClass<SeriesDataPoint>()("SeriesDataPoint", {
  series: Schema.String,
  x: Schema.Union([Schema.Number, Schema.String]),
  y: Schema.Number,
}) {}

export class ScatterDataPoint extends Schema.TaggedClass<ScatterDataPoint>()("ScatterDataPoint", {
  x: Schema.Number,
  y: Schema.Number,
  size: Schema.optionalKey(Schema.Number),
  label: Schema.optionalKey(Schema.String),
}) {}

export class RadarDataPoint extends Schema.TaggedClass<RadarDataPoint>()("RadarDataPoint", {
  category: Schema.String,
  metric: Schema.String,
  value: Schema.Number,
}) {}

// ── Special Charts ──

export class HeatmapDataPoint extends Schema.TaggedClass<HeatmapDataPoint>()("HeatmapDataPoint", {
  x: Schema.Union([Schema.String, Schema.Number]),
  y: Schema.Union([Schema.String, Schema.Number]),
  value: Schema.Number,
}) {}

export class TreemapDataPoint extends Schema.TaggedClass<TreemapDataPoint>()("TreemapDataPoint", {
  name: Schema.String,
  value: Schema.Number,
  children: Schema.optionalKey(
    Schema.Array(Schema.suspend((): Schema.Schema<TreemapDataPoint> => TreemapDataPoint)),
  ),
}) {}

export class SankeyLink extends Schema.TaggedClass<SankeyLink>()("SankeyLink", {
  source: Schema.String,
  target: Schema.String,
  value: Schema.Number,
}) {}

export class FunnelDataPoint extends Schema.TaggedClass<FunnelDataPoint>()("FunnelDataPoint", {
  name: Schema.String,
  value: Schema.Number,
}) {}

export class WordCloudDataPoint extends Schema.TaggedClass<WordCloudDataPoint>()(
  "WordCloudDataPoint",
  {
    text: Schema.String,
    weight: Schema.Number,
  },
) {}

export class BoxPlotDataPoint extends Schema.TaggedClass<BoxPlotDataPoint>()("BoxPlotDataPoint", {
  label: Schema.String,
  min: Schema.Number,
  q1: Schema.Number,
  median: Schema.Number,
  q3: Schema.Number,
  max: Schema.Number,
}) {}

export class CandlestickDataPoint extends Schema.TaggedClass<CandlestickDataPoint>()(
  "CandlestickDataPoint",
  {
    time: Schema.Union([Schema.String, Schema.Number]),
    open: Schema.Number,
    high: Schema.Number,
    low: Schema.Number,
    close: Schema.Number,
  },
) {}

export class GaugeDataPoint extends Schema.TaggedClass<GaugeDataPoint>()("GaugeDataPoint", {
  name: Schema.String,
  value: Schema.Number,
  min: Schema.optionalKey(Schema.Number),
  max: Schema.optionalKey(Schema.Number),
  units: Schema.optionalKey(Schema.String),
}) {}

export const ChartDataPoint = Schema.suspend(() =>
  Schema.Union([
    BarDataPoint,
    GroupedBarDataPoint,
    PieDataPoint,
    LineDataPoint,
    SeriesDataPoint,
    ScatterDataPoint,
    RadarDataPoint,
    HeatmapDataPoint,
    TreemapDataPoint,
    SankeyLink,
    FunnelDataPoint,
    WordCloudDataPoint,
    BoxPlotDataPoint,
    CandlestickDataPoint,
    GaugeDataPoint,
  ]),
);
