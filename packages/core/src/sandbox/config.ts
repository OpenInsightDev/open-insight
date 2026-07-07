export type Config = Readonly<{
  /**
   * Whether to cache the task snapshot after built.
   * If not, the task snapshot will be rebuilt every time the task is scheduled to run.
   */
  cacheTaskSnapshot?: boolean;

  /**
   * Whether to cache the snapshot with agent specific environment.
   * If not, the snapshot will be rebuilt every time the agent is started.
   */
  cacheAgentSnapshot?: boolean;
}>;
