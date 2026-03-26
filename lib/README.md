# `lib/` placement guide

`lib/` contains content-agnostic runtime infrastructure for `bundle-rantamuta`.
It should not contain area-specific IDs, puzzle logic, or authored content behavior.

This guide is intentionally lightweight. It describes the current layout and
gives default placement rules for new code without forcing a large taxonomy
change all at once.

## Current top-level folders

- `session/`
  - Session and transport lifecycle.
  - Examples: auth flow, I/O adapters, player enter/quit lifecycle.

- `runtime/`
  - Runtime systems that execute game behavior.
  - Prefer putting subsystem-owned code here rather than creating new
    top-level folders too quickly.
  - Current subfolders include `command/`, `conversation/`, `doors/`, and
    `mutation/`.

- `helpers/`
  - Small shared helpers that do not yet have a clear owning subsystem.
  - This folder is provisional, not a signal that "miscellaneous utilities"
    are a preferred long-term home.

- `inline-tags/`
  - Inline tag parsing/rendering/resolution support.
  - This currently stands alone as a rendering-oriented subsystem.

## Default placement rules

- If code is clearly session/transport lifecycle, put it in `session/`.
- If code is owned by a runtime subsystem, put it under the most specific
  `runtime/**` folder that fits.
- If code is a small truly shared helper with no clear owner, `helpers/` is
  acceptable.
- If a helper is mostly owned by one subsystem, prefer moving it toward that
  subsystem instead of leaving it indefinitely in `helpers/`.

## Guidance for `helpers/`

Treat `helpers/` as a temporary holding area for genuinely shared code, not as
a catch-all.

- Good fit:
  - small cross-cutting helpers,
  - narrow utilities used by multiple subsystems,
  - code whose owner is honestly unclear today.

- Poor fit:
  - runtime subsystem logic,
  - rendering systems with their own internal structure,
  - world mutation or command pipeline behavior,
  - modules that are only "helpers" because they were written early.

If a coherent set of truly shared helpers emerges, a future `shared/` sibling
folder would be reasonable. We are not imposing that now.

## Future categories

New top-level siblings of `runtime/` and `session/` should be broad category
classes, not feature folders.

Examples that could make sense in the future if the codebase grows that way:

- `shared/`
- `render/`
- `validation/`
- `world/`
- `io/`
- `boot/`

Examples that usually should not become top-level siblings on their own:

- `doors/`
- `inline-tags/`
- other narrow feature-specific buckets

Those narrower systems should usually live under an owning broad category such
as `runtime/**` or a future sibling like `render/`.

## Decision rule

When deciding where new code should go:

1. Prefer the narrowest clear owner.
2. Prefer `runtime/**` over creating a new top-level category.
3. Use `helpers/` only when ownership is genuinely unclear or truly shared.
4. Add a new top-level sibling only when it represents a durable architectural
   class rather than a single subsystem.
