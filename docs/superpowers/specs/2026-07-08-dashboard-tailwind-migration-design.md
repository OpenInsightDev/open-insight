# Dashboard Tailwind Migration Design

## Context

`apps/dashboard` is a Vite React app using Tailwind CSS v4, shadcn `base-nova`, Base UI primitives, Geist, Recharts, and Vite+. The app already has `components.json` configured with Tailwind CSS at `src/index.css`, aliases under `@/`, and installed shadcn components for buttons, cards, tabs, charts, badges, chat primitives, attachments, markers, and tooltips.

The current styling is split across two systems:

- `src/index.css` contains the Tailwind v4 imports, shadcn theme variables, `@theme inline`, and base layer, but also includes leftover global template styles such as `#root`, generic heading, paragraph, and code rules, plus non-shadcn variables like `--text`, `--text-h`, `--bg`, and `--code-bg`.
- `src/App.css` contains the dashboard-specific implementation: shell layout, tabs, task rails, panels, metric cards, chart sizing, streaming message overrides, agent stream layout, status pills, responsive breakpoints, and several raw CSS selectors.

The migration must remove non-essential handwritten CSS and make Tailwind/shadcn the normative styling system.

## Goals

- Establish a clean Tailwind v4 and shadcn theme foundation before migrating component styles.
- Delete `src/App.css` and remove its import from `src/App.tsx`.
- Move dashboard layout, typography, spacing, responsive behavior, and state styling into Tailwind utility classes and `cn()` expressions.
- Keep shadcn components as the primary UI vocabulary, especially `Tabs`, `Card`, `Badge`, `MessageScroller`, `Message`, `Bubble`, `Attachment`, and `Marker`.
- Preserve the current dashboard information architecture, visual density, and product-register tone: professional, high-information, minimal, and evidence-first.
- Avoid raw one-off CSS selectors for app UI. Any remaining global CSS must be theme infrastructure, not page styling.

## Non-Goals

- Do not redesign the dashboard layout or change product behavior.
- Do not split the large `App.tsx` into a new component architecture unless a tiny local helper is necessary for class composition.
- Do not add new UI libraries or replace shadcn/Base UI primitives.
- Do not migrate generated assets or built `dist` files.
- Do not rewrite chart data, store logic, or Effect code.

## Styling Boundary

Allowed global CSS in `apps/dashboard/src/index.css`:

- Tailwind/shadcn imports: `@import "tailwindcss"`, `tw-animate-css`, `shadcn/tailwind.css`, and Geist font import.
- `@custom-variant dark`.
- shadcn semantic theme variables in `:root` and `.dark`.
- `@theme inline` mappings for Tailwind v4.
- Minimal `@layer base` rules such as global border, outline, body background, text color, and font family.

Disallowed global CSS after migration:

- `src/App.css`.
- Dashboard/page selectors such as `.dashboard-shell`, `.task-tab`, `.panel`, `.metric-card`, `.agent-stream-page`, and `.streaming-message-*`.
- Vite template global styles for headings, paragraphs, `#root`, `code`, or custom text/background aliases that compete with shadcn tokens.
- Raw status color selectors such as `.status-running`.

Acceptable runtime style exception:

- `style={{ width: metricBarWidth(metric.value) }}` may remain for the mini metric bar because the width is runtime data visualization output, not arbitrary visual styling. Static appearance around that bar must use Tailwind classes.

## Architecture

### Theme Layer

`apps/dashboard/src/index.css` becomes the single theme entry point. It should keep the existing Tailwind v4 and shadcn setup and remove legacy variables that duplicate semantic tokens. Code surfaces should use shadcn/Tailwind tokens such as `bg-muted`, `text-foreground`, `font-mono`, `border-border`, and `ring-*` instead of `--code-bg`, `--text`, or `--bg`.

The dashboard remains restrained and neutral. Status indicators should use component variants and semantic tokens. If more status nuance is needed, add explicit semantic theme variables only after confirming they represent product state vocabulary rather than one-off colors.

### App Layout Layer

`apps/dashboard/src/App.tsx` should own layout via Tailwind utilities:

- Shell and header: `min-h-svh`, `bg-background`, `text-foreground`, grid/flex utilities, responsive padding.
- Page sections: responsive grids using Tailwind arbitrary grid templates where necessary.
- Task rail and selector buttons: Tailwind grid/flex, borders, hover states, and active states via `cn()`.
- Panels: prefer the existing shadcn `Card` composition where it fits. For current `Panel` helper, either implement it with `Card`, `CardHeader`, `CardTitle`, `CardAction`, and `CardContent`, or keep a local semantic helper whose appearance is entirely Tailwind classes.
- Metric/stat cards: Tailwind grid, border, typography, and `tabular-nums`; no CSS selectors.
- Chart sizing: pass Tailwind classes to `ChartContainer` such as fixed/min heights and responsive constraints.
- Code and JSON blocks: use `pre` with Tailwind classes for border, radius, padding, `bg-muted`, `font-mono`, `text-xs`, `whitespace-pre-wrap`, and scroll bounds.

### Streaming Message Layer

`apps/dashboard/src/components/streaming-message/streaming-message.tsx` should migrate its selector classes into Tailwind utilities. Existing chat primitives must remain:

- `MessageScrollerProvider` -> `MessageScroller` -> `MessageScrollerViewport` -> `MessageScrollerContent` -> `MessageScrollerItem`.
- `Message`, `Bubble`, `Attachment`, and `Marker` continue to provide chat structure.
- Placeholder and streaming text should use the existing `shimmer` utility.
- Debug JSON and pre blocks should use Tailwind utilities, not shared CSS selectors.

### Status Components

`StatusPill` should stop depending on CSS classes like `status-running`. It should use `Badge` variants and semantic Tailwind classes composed with `cn()`. Color must not be the only status indicator; status text remains visible.

Task and trail selector active states should use `cn()` rather than string ternaries. Active state can use semantic tokens such as `bg-primary text-primary-foreground` or shadcn-like selected states.

## Migration Sequence

1. Clean `src/index.css` so the theme foundation is canonical before component migration.
2. Convert shared local helpers in `App.tsx` first: `Panel`, `StatusPill`, stat grids, metric grids, code blocks, and selector buttons.
3. Migrate top-level dashboard sections: header, dashboard tabs wrapper, task layout, benchmark stats, chart gallery, and agent stream.
4. Migrate `streaming-message.tsx` classes to Tailwind utilities.
5. Remove the `App.css` import and delete `src/App.css`.
6. Run searches to prove no `App.css` import, no dashboard selector classes, and no legacy theme variables remain.

## Testing And Verification

Use Vite+ commands from the repository root unless a command specifically needs the app directory.

- Run `vp check` for formatting, linting, and type checking.
- Run `vp test` for unit tests.
- Run `vp run dashboard#build` or `vp run -r build` if task/build routing requires workspace selection.
- Run targeted searches:
  - `rg -n 'App.css|dashboard-shell|task-tab|status-pill|streaming-message-' apps/dashboard/src`
  - `rg -n 'var\\(--text|var\\(--bg|var\\(--code-bg|--text|--bg|--code-bg' apps/dashboard/src`
  - `rg -n 'className=\\{[^}]*\\?[^}]*:' apps/dashboard/src/App.tsx apps/dashboard/src/components/streaming-message/streaming-message.tsx`
- If a dev server is started for visual validation, inspect desktop and mobile widths and confirm no overlap in header, rails, tabs, chart cards, stream messages, and code blocks.

## Risks And Mitigations

- `App.tsx` is large. Keep the migration scoped and avoid unrelated component extraction.
- Tailwind arbitrary values can become another form of handwritten styling. Use standard utilities first and arbitrary values only for structural constraints already present in the app, such as grid templates or chart heights.
- Removing global heading/code styles may reveal implicit dependencies. Replace those dependencies explicitly at the call sites with Tailwind classes.
- shadcn rules discourage overriding component typography and colors through `className`. Prefer variants and semantic tokens; use layout classes freely.
- Existing unrelated worktree changes must not be staged or reverted.

## Acceptance Criteria

- `apps/dashboard/src/App.css` no longer exists.
- `apps/dashboard/src/App.tsx` no longer imports `./App.css`.
- `apps/dashboard/src/index.css` contains only Tailwind/shadcn theme infrastructure and minimal base rules.
- Dashboard UI styles are expressed through Tailwind utilities, shadcn variants, and `cn()`.
- Chat and streaming message UI still uses the shadcn chat primitives.
- Vite+ checks and tests pass, or any failure is reported with exact output and cause.
