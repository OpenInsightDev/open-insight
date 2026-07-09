# Dashboard Design Direction

This document records the preferred visual direction for the dashboard app. Treat it as the design source of truth when shaping new screens, component states, and visual polish.

## Core Mood

The dashboard should feel quiet, focused, and material. It favors calm attention over decorative drama: the interface should recede until the user focuses a region, then that region earns clearer color, stronger contrast, and a little more presence.

## Layering

- Secondary hierarchy must appear as floating layers, not sunken or inset layers.
- Floating layers should use tasteful shadow, elevation, and separation from the base surface.
- Secondary-layer backgrounds should use a carefully designed gray glass material: subtle blur, restrained transparency, visible depth, and enough opacity for legibility.
- Avoid heavy card stacking. Use floating panels only when they clarify hierarchy, state, or focus.

## Shape And Edge

- All framed elements use small-radius rectangles.
- Every framed element must have a 1px edge that is slightly darker than the surface it encloses.
- Avoid pill-shaped or heavily rounded panels, cards, inputs, and menus unless the component's standard affordance truly requires it.
- Borders should feel material and precise, not decorative.

## Motion

- Animation should be based on blur transitions: unfocused or entering content resolves from soft blur into clarity.
- Avoid dynamic slide-in, slide-out, fly-in, or bouncing entrance motion.
- Prefer short, stateful transitions that change clarity, shadow, contrast, and material presence.
- Reduced-motion behavior must preserve the state change without movement.

## Zen Focus Model

- The default page state is zen mode: only the content the user is currently focused on should receive extra visual emphasis.
- On desktop, hover is the primary focus signal. Hovered regions may gain normal color, sharper text, slightly stronger elevation, or a restrained scale increase.
- Non-focused content should remain present but quieter: lower contrast, softened color, reduced emphasis, and less visual pull.
- The focused region should never become loud; it should simply become the clearest thing on the screen.

## Color

- Use `#0077CC` as the single theme color across the dashboard.
- All other colors must be neutral, or extremely restrained neighboring tones of the theme color.
- Keep the total color impression tightly controlled. The page should not read as multicolor.
- Use the theme color for selection, primary action, and meaningful state only, not decoration.

## Typography

- Prefer a humanist serif direction.
- English text should lean toward Linux Libertine or a compatible humanist serif with similar proportions.
- Chinese text should use a paired Chinese typeface that harmonizes with the English serif instead of fighting it.
- UI labels, data, and dense controls still need strong legibility; the serif choice must serve repeated dashboard use, not only editorial atmosphere.
