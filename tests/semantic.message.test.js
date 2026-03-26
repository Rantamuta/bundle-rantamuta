// @ts-check
'use strict';

const assert = require('assert');
const { inflectVerb, renderSemanticEvent } = require('../lib/runtime/command/semantic-message');

describe('bundle-rantamuta semantic-message', function () {
  it('keeps base verb for subject viewer and inflects for non-subject viewer', function () {
    assert.strictEqual(inflectVerb('wave', false), 'wave');
    assert.strictEqual(inflectVerb('wave', true), 'waves');
  });

  it('applies irregular dictionary and deterministic suffix fallbacks', function () {
    assert.strictEqual(inflectVerb("don't", true), "doesn't");
    assert.strictEqual(inflectVerb('bluff', true), 'bluffs');
    assert.strictEqual(inflectVerb('carry', true), 'carries');
    assert.strictEqual(inflectVerb('watch', true), 'watches');
  });

  it('renders actor/target perspectives for a canonical event', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave} at {target.you}.',
      audiencePolicy: 'self_target_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo' },
      indirectTarget: { name: 'Bar' },
    };

    const selfResult = renderSemanticEvent(instruction, context, 'self');
    const targetResult = renderSemanticEvent(instruction, context, 'target');
    const otherResult = renderSemanticEvent(instruction, context, 'other');

    assert.deepStrictEqual(selfResult, {
      ok: true,
      included: true,
      text: 'You wave at Bar.',
    });
    assert.deepStrictEqual(targetResult, {
      ok: true,
      included: true,
      text: 'Foo waves at you.',
    });
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: 'Foo waves at Bar.',
    });
  });

  it('supports currentActor selector for actor participant resolution', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave}.',
      audiencePolicy: 'self_and_others',
      participants: {
        actor: { selector: 'currentActor' },
      },
    };
    const context = {
      currentActor: { name: 'Foo', isNpc: false },
    };

    const selfResult = renderSemanticEvent(instruction, context, 'self');
    const otherResult = renderSemanticEvent(instruction, context, 'other');

    assert.deepStrictEqual(selfResult, {
      ok: true,
      included: true,
      text: 'You wave.',
    });
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: 'Foo waves.',
    });
  });

  it('fails with SEMANTIC_ACTOR_ALIAS_MISMATCH when currentActor and currentPlayer differ', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave}.',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentActor' },
      },
    };
    const context = {
      currentActor: { uuid: 'actor-1', name: 'Foo', isNpc: false },
      currentPlayer: { uuid: 'actor-2', name: 'Bar', isNpc: false },
    };

    const result = renderSemanticEvent(instruction, context, 'self');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'SEMANTIC_ACTOR_ALIAS_MISMATCH');
  });

  it('accepts currentActor/currentPlayer alias when identities match', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave}.',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentActor' },
      },
    };
    const context = {
      currentActor: { uuid: 'actor-1', name: 'Foo', isNpc: false },
      currentPlayer: { uuid: 'actor-1', name: 'Foo', isNpc: false },
    };

    const result = renderSemanticEvent(instruction, context, 'self');
    assert.deepStrictEqual(result, {
      ok: true,
      included: true,
      text: 'You wave.',
    });
  });

  it('returns SEMANTIC_ACTOR_UNRESOLVED when currentActor cannot be resolved', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave}.',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentActor' },
      },
    };

    const result = renderSemanticEvent(instruction, {}, 'self');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'SEMANTIC_ACTOR_UNRESOLVED');
  });

  it('returns empty text when pov is outside audience policy', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave}.',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo' },
    };

    const result = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(result, {
      ok: true,
      included: false,
      text: '',
    });
  });

  it('returns structured failure for unknown placeholders', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:wave} {unknown.slot}',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo' },
    };

    const result = renderSemanticEvent(instruction, context, 'self');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'SEMANTIC_TEMPLATE_INVALID');
  });

  it('uses he/she/it pronouns for possessive and reflexive forms', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:stab} {target.you} in {target.poss} neck and braces {actor.refl}.',
      audiencePolicy: 'self_target_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo', pronoun: 'he' },
      indirectTarget: { name: 'Bar', pronoun: 'she' },
    };

    const otherResult = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: 'Foo stabs Bar in her neck and braces himself.',
    });
  });

  it('falls back to name_poss for character targets without pronoun', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:stab} {target.you} in {target.poss} neck.',
      audiencePolicy: 'self_target_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo', isNpc: false },
      indirectTarget: { name: 'Bar', isNpc: true },
    };

    const otherResult = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: "Foo stabs Bar in Bar's neck.",
    });
  });

  it('falls back to its/itself for non-character targets without pronoun', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:polish} {target.you} and admires {target.poss} surface itself via {target.refl}.',
      audiencePolicy: 'self_target_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo', isNpc: false },
      indirectTarget: { name: 'Lantern' }, // no isNpc -> non-character
    };

    const otherResult = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: 'Foo polishes Lantern and admires its surface itself via itself.',
    });
  });

  it('supports explicit name_poss placeholders', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} points at {target.name_poss} blade and guards {actor.name_poss} own hand.',
      audiencePolicy: 'self_target_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo', pronoun: 'he' },
      indirectTarget: { name: 'Bar', pronoun: 'she' },
    };

    const otherResult = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: "Foo points at Bar's blade and guards Foo's own hand.",
    });
  });

  it('supports capitalization for actor/target placeholders only', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.You} {verb:stab} {target.you} in {target.Poss} neck.',
      audiencePolicy: 'others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'Foo', pronoun: 'he' },
      indirectTarget: { name: 'Bar', pronoun: 'she' },
    };

    const otherResult = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: 'Foo stabs Bar in Her neck.',
    });
  });

  it('does not apply capitalization to verb/object tokens', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.You} {verb:Stab} {object.Direct}.',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
      objectText: {
        direct: 'the coin',
      },
    };
    const context = {
      currentPlayer: { name: 'Foo', pronoun: 'he' },
    };

    const selfResult = renderSemanticEvent(instruction, context, 'self');
    assert.deepStrictEqual(selfResult, {
      ok: true,
      included: true,
      text: 'You stab the coin.',
    });
  });

  it('always capitalizes actor.name tokens', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.name} nods.',
      audiencePolicy: 'others',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
    };
    const context = {
      currentPlayer: { name: 'rendall', isNpc: false },
    };

    const otherResult = renderSemanticEvent(instruction, context, 'other');
    assert.deepStrictEqual(otherResult, {
      ok: true,
      included: true,
      text: 'Rendall nods.',
    });
  });

  it('capitalizes target.name for character targets but preserves object casing', function () {
    const characterInstruction = {
      type: 'semanticEvent',
      template: '{target.name}.',
      audiencePolicy: 'others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };

    const characterResult = renderSemanticEvent(characterInstruction, {
      currentPlayer: { name: 'foo', isNpc: false },
      indirectTarget: { name: 'bar', isNpc: true },
    }, 'other');
    assert.deepStrictEqual(characterResult, {
      ok: true,
      included: true,
      text: 'Bar.',
    });

    const objectResult = renderSemanticEvent(characterInstruction, {
      currentPlayer: { name: 'foo', isNpc: false },
      indirectTarget: { name: 'wax seal' },
    }, 'other');
    assert.deepStrictEqual(objectResult, {
      ok: true,
      included: true,
      text: 'wax seal.',
    });
  });

  it('capitalizes target names for target.you when recipient is not the target', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:stab} {target.you} in {target.poss} neck!',
      audiencePolicy: 'self_target_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'foo', pronoun: 'he', isNpc: false },
      indirectTarget: { name: 'bar', pronoun: 'she', isNpc: true },
    };

    const selfResult = renderSemanticEvent(instruction, context, 'self');
    assert.deepStrictEqual(selfResult, {
      ok: true,
      included: true,
      text: 'You stab Bar in her neck!',
    });
  });

  it('preserves object casing for target.you when target is non-character', function () {
    const instruction = {
      type: 'semanticEvent',
      template: '{actor.you} {verb:examine} {target.you}.',
      audiencePolicy: 'self_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
        target: { selector: 'entityByContextRole', role: 'indirectTarget' },
      },
    };
    const context = {
      currentPlayer: { name: 'rendall', isNpc: false },
      indirectTarget: { name: 'wax seal' },
    };

    const selfResult = renderSemanticEvent(instruction, context, 'self');
    assert.deepStrictEqual(selfResult, {
      ok: true,
      included: true,
      text: 'You examine wax seal.',
    });
  });
});
