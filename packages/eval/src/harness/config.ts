export type Config = Readonly<{
  readonly snapshotConcurrency?: number;
  readonly trailConcurrency?: number;
  readonly taskConcurrency?: number;
}>;
