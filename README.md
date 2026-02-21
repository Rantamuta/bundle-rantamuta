# bundle-rantamuta

This is the reference bundle for the Rantamuta MUD engine, which means that it contains both recommended conventions and a base bundle on which you can build your own MUD.

## v1.0 Capability Checklist

This checklist tracks feature areas required for a 1.0 reference-bundle release.

### Core Runtime Surfaces

- [ ] Core World Authoring (Areas, Rooms, Items, Exits, Doors)
  - [ ] Production world content is implemented in `areas/rantamuta`.
  - [ ] Exit and door authoring patterns are documented for designers.
  - [ ] Coverage exists for core room/item/exit traversal behavior.
- [x] Commands and Input Events
  - [x] Core player command surface is implemented for production play.
  - [x] Input event pipeline is wired and covered by tests/scenarios.
  - [x] Designer-facing command usage and behavior expectations are documented.
- [x] Doors and Movement
  - [x] Door and movement behavior is implemented and validated.
  - [x] Virtual door and facade patterns are implemented for production content.
  - [x] Coverage exists for door-state and movement-state interaction paths.
- [x] Render Predicates
  - [x] Area-local render predicate runtime is implemented.
  - [x] Predicate-driven room state rendering is integrated in production content.
  - [x] Designer-facing predicate authoring guidance is documented.
  - [x] Predicate runtime and stateful room-render coverage is in place.
- [ ] Scripts
  - [ ] Area, room, item, and NPC script usage is implemented in production content.
  - [ ] Script authoring guidance is documented for designers.
  - [ ] Coverage exists for script-driven content behavior.
- [ ] Behaviors
  - [ ] Reusable behavior modules are implemented for production use.
  - [ ] Behavior-vs-script guidance is documented for designers.
  - [ ] Coverage exists for behavior-driven content logic.
- [x] Server Events
  - [x] Server lifecycle hooks are implemented (`startup`/`shutdown`).
  - [x] Server-event behavior is covered by tests or smoke validation.
  - [x] Operational guidance for lifecycle responsibilities is documented.
- [ ] Namespacing and Reference Integrity
  - [ ] Content references use consistent `area:id` namespacing.
  - [ ] Bundle validation gates reference integrity in CI/local workflows.
  - [ ] Designer guidance exists for safe renames and cross-file references.

### Gameplay Systems

- [ ] NPCs
  - [ ] Production NPC flows are implemented in `areas/rantamuta`.
  - [ ] Designer-facing authoring section is documented.
  - [ ] Unit and scenario coverage is in place.
- [ ] Quests and Quest Rewards
  - [ ] Production quest flows are implemented in `areas/rantamuta`.
  - [ ] Quest reward flows are implemented.
  - [ ] Designer-facing quest/reward authoring guidance exists.
  - [ ] Unit and scenario coverage validates acceptance and reward outcomes.
- [ ] Shops
  - [ ] Buy and sell flows are implemented.
  - [ ] Currency and stock edge cases are covered by tests.
  - [ ] Designer-facing vendor metadata docs and examples exist.
- [ ] Crafting
  - [ ] Resource acquisition and recipe execution are implemented.
  - [ ] Failure messaging (missing materials/invalid recipes) is covered.
  - [ ] Scenario coverage validates full crafting loops.
- [ ] Combat
  - [ ] Combat loop behavior is implemented and validated.
  - [ ] Deterministic tests cover hit/damage/end-state behavior.
  - [ ] Designer-facing encounter authoring guidance exists.
- [ ] Skills
  - [ ] Active and passive skills are implemented.
  - [ ] Resource and cooldown behavior is covered by tests.
  - [ ] Authoring contract is documented for designers.
- [ ] Spells
  - [ ] Production spell flows are implemented.
  - [ ] Cast/resource/cooldown/failure behavior is covered by tests.
  - [ ] Designer-facing spell authoring guidance exists.
- [ ] Effects
  - [ ] Duration, stacking, and refresh rules are implemented and tested.
  - [ ] Effects are integrated into production content.
  - [ ] Designer templates/examples are documented.
- [ ] Attributes
  - [ ] Production attributes used by content are defined and documented.
  - [ ] Attribute-dependent gameplay behavior is covered by tests.
  - [ ] Designer-facing attribute authoring guidance exists.

### Player Experience and Social Surfaces

- [ ] Channels
  - [ ] Channel declaration and delivery behavior is implemented.
  - [ ] Audience/permission behavior is covered by tests.
  - [ ] Designer-facing channel usage guidance is documented.
- [ ] Help (In-game Documentation)
  - [ ] Designers can author in-game help topics in content files.
  - [ ] Help lookup/render behavior is covered by tests.
  - [ ] Designer-facing help authoring guidance and examples exist.
- [ ] Groups
  - [ ] Group formation and membership flows are implemented.
  - [ ] Group interaction behavior is documented.
  - [ ] Coverage exists for group lifecycle behavior.
- [ ] Progressive Respawn (or explicit replacement policy)
  - [ ] Spawn/reset behavior is implemented and documented.
  - [ ] Designer knobs are documented.
  - [ ] Test/scenario coverage exists for spawn/reset expectations.

## v1.0 Release Gate

- [ ] `npm test` passes.
- [ ] `npm run ci:local` passes.
- [ ] Smoke validation passes (startup/login path).
- [ ] Each checked capability above links to:
  - [ ] production content examples in `areas/rantamuta`
  - [ ] automated tests
  - [ ] designer-facing documentation
