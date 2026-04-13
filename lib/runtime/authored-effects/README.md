# Authored Effects

This directory holds the runtime support for **authored effects**.

In this codebase, "authored effects" means:

- mutation operations and rendering instructions written as YAML
- validated and lowered into the runtime's existing mutation-operation and
  render-message contracts

Authored effects are **not** a second execution system.
They are a declarative authoring surface that reuses the normal runtime
instruction model.

In plain terms:

- authors write effect data
- runtime code validates that data
- runtime code resolves any documented references
- runtime code lowers the effect data into canonical operations/messages
- existing mutator/render layers execute those results

## Boundary

Files in this package should stay focused on the authored-effects bridge.

That means this directory is the right place for code that:

- defines authored-effects result contracts
- validates authored-effects payloads
- resolves documented authored-effects references from explicit runtime scope
- lowers authored-effects entries into canonical runtime instruction data
- exposes the small public surface for those helpers

This directory is not the right place for code that:

- executes mutation plans
- renders messages
- owns conversation state or conversation evaluation
- performs broad entity resolution outside the documented authored-effects scope
- introduces content-specific behavior

## Current Files

`contracts.js`

- Shared typedefs and constructor helpers for validation and transposition
  results.

`validator.js`

- Structural validation for supported authored-effects payloads.
- Produces findings using the shared contracts.

`reference-resolution.js`

- Narrow reference helpers for the authored-effects scope.
- Resolves documented context symbols such as `player`, `actor`, `npc`,
  `room`, `area`, and `inventory`.
- Expands and resolves supported room references.

`transposer.js`

- Main lowering layer.
- Takes validated authored-effects data plus explicit runtime scope and returns
  canonical mutation operations and render messages, or one structured failure.

`index.js`

- Barrel export for the authored-effects package.

## What Belongs Here

New files added here should support the same authored-effects runtime seam.

Good fits:

- a new shared helper used only by authored-effects validation/lowering
- an additional reference helper for documented authored-effects scope rules
- a narrowly scoped lowering helper if `transposer.js` needs to be split
- shared authored-effects constants that define package-local contracts

Poor fits:

- mutator logic
- render dispatch logic
- command routing
- conversation progression state
- area- or puzzle-specific runtime code

## Relationship To Conversations

Conversation definitions are currently the main authored-effects caller, but
this package is intentionally not conversation-specific.

The goal is for any authored content surface to be able to say:

- "here is an array of authored effects"
- "here is the explicit runtime scope they may resolve against"

and receive canonical runtime instructions back.
