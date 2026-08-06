import type { UnionToIntersection } from "effect/Types";

type Recordify<T> = UnionToIntersection<T extends string ? Record<T, string> : never>;

export type Codex = Recordify<
  | "OPENAI_API_KEY"
  | "OPENAI_BASE_URL"
  | "OPENAI_MODEL"
  | "DEFAULT_AUTH_REQUEST"
  | "NO_BROWSER"
  | "INITIAL_AGENT_MODE"
  | "CODEX_CONFIG"
>;
