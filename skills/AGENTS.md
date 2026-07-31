# Skill Authoring

## Principle

- Prefer actionable instructions over explanation, and include only the context needed to make the instruction correct.
- Explain APIs through the user's decision model: state which requirement each API serves, how to choose between alternatives, and the common cases where each alternative is wrong.
- Describe implementation only when they change how an agent should use the API correctly.

## Writing

- Write skill content in concise English for agents.
- Put each natural prose sentence on its own line and do not hard-wrap sentences to a fixed width.
- Remove meta-explanations about the documentation itself when the instruction can be stated directly.
- Do not introduce type annotations merely to explain inferred API shapes; rely on contextual typing.

## Examples

- ONLY USE public APIs exposed in `<module>/export.ts`.
- Ground API guidance and examples in the current implementation and tests instead of inventing behavior.
- Use Deno APIs and Deno-compatible imports in examples instead of Node.js APIs.
- Demonstrate the intended ergonomic call site and let the API infer callback parameters and return values.
- Keep one-use callbacks inline when extracting them would require otherwise unnecessary types, aliases, or annotations.
- Use examples to clarify selection and usage, not to expose implementation details.
