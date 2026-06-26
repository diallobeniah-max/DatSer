---
name: motion-design
description: Use when refining UI transitions, micro-interactions, page changes, and responsive motion so animation feels purposeful, fast, accessible, and aligned with product behavior.
---

# Motion Design

Use motion as interface communication, not decoration. A transition should explain what changed, preserve the user's sense of place, and make the app feel responsive rather than theatrical.

## Principles

- Start with intent: name what the motion should clarify. Examples: "this control opens Settings," "this card expands in place," "this prompt is dismissed."
- Keep timing short: most tap feedback should complete in 120-220ms; page/surface transitions can take 180-320ms. Avoid long delays before navigation.
- Use one primary motion idea per interaction. Combine opacity, scale, or translation only when they reinforce the same story.
- Prefer transform and opacity. Avoid animating layout-heavy properties unless the element is small and isolated.
- Use easing deliberately:
  - `cubic-bezier(0.16, 1, 0.3, 1)` for polished entrance/settle.
  - `ease-out` for quick feedback.
  - `ease-in` for dismissals.
- Respect reduced motion. If `prefers-reduced-motion: reduce` is active or the app disables animations, remove travel/scale and keep instant or subtle opacity changes.
- Keep the app fast. Motion should never block navigation, data loading, or form actions.

## Implementation checklist

1. Identify the trigger, destination, and user's expected mental model.
2. Add immediate tap feedback on the trigger when useful.
3. Add a lightweight transition on the destination surface if it helps connect cause to effect.
4. Keep keyboard focus and ARIA behavior unchanged.
5. Add reduced-motion CSS or logic.
6. Verify on phone, tablet, and desktop.

## Quality bar

Good motion feels like the interface breathing: quick, legible, and gone before the user has time to wait for it.
