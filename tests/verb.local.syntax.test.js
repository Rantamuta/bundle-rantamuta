// @ts-check
'use strict';

const assert = require('assert');

const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/runtime/command/entity-resolution');
const Syntax = require('../lib/runtime/command/verb-local-syntax');

function createNpc(def = {}) {
  return {
    uuid: def.uuid || `npc-${String(def.name || 'npc').replace(/\s+/gu, '-')}`,
    name: def.name || 'npc',
    keywords: def.keywords || [],
    isNpc: true,
    metadata: def.metadata || {},
  };
}

function createPlayer(def = {}) {
  const roomNpcs = Array.isArray(def.roomNpcs) ? def.roomNpcs : [];
  const room = def.room || {
    npcs: new Set(roomNpcs),
  };

  return {
    inventory: new Map(),
    room,
  };
}

describe('bundle-rantamuta verb-local syntax', function () {
  it('compiles syntax strings into ordered atom patterns', function () {
    const compiled = Syntax.compileSyntaxRules('say', ['TEXT to LIVING', 'TEXT']);

    assert.strictEqual(compiled.length, 2);
    assert.strictEqual(compiled[0].ruleText, 'TEXT to LIVING');
    assert.strictEqual(compiled[0].compiledRuleId, 'say:0');
    assert.deepStrictEqual(compiled[0].atoms, [
      { type: 'slot', kind: 'TEXT' },
      { type: 'literal', value: 'to' },
      { type: 'slot', kind: 'LIVING' },
    ]);
    assert.strictEqual(compiled[0].canonicalRelationToken, 'to');

    assert.strictEqual(compiled[1].ruleText, 'TEXT');
    assert.strictEqual(compiled[1].compiledRuleId, 'say:1');
    assert.deepStrictEqual(compiled[1].atoms, [
      { type: 'slot', kind: 'TEXT' },
    ]);
  });

  it('precompiles syntax metadata for command modules at load time', function () {
    const metadata = Syntax.compileCommandSyntaxMetadata('look', {
      syntaxRules: ['(empty)', 'ENTITY'],
      errorMessages: {
        LOOK_NO_ROOM: 'You are nowhere.',
      },
    });

    assert.deepStrictEqual(metadata.syntaxRules, ['(empty)', 'ENTITY']);
    assert.ok(Array.isArray(metadata.compiledRules));
    assert.strictEqual(metadata.compiledRules.length, 2);
    assert.strictEqual(metadata.compiledRules[0].compiledRuleId, 'look:0');
    assert.deepStrictEqual(metadata.errorMessages, {
      LOOK_NO_ROOM: 'You are nowhere.',
    });
  });

  it('resolves syntaxRules declarations through the linked interpretation step', function () {
    const tomo = createNpc({ uuid: 'npc-tomo', name: 'tomo', keywords: ['caretaker'] });
    const player = createPlayer({ roomNpcs: [tomo] });
    const command = {
      metadata: {
        syntaxRules: ['TEXT to LIVING', 'TEXT'],
        entityResolution: {
          rules: {
            indirect: {
              acceptedRelations: ['to'],
              scopeProfile: {
                indirect: ['room.npcs'],
              },
            },
          },
        },
      },
    };

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('say hello there to tomo'));

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.matchedRuleText, 'TEXT to LIVING');
    assert.strictEqual(result.value.compiledRuleId, 'say:0');
    assert.strictEqual(result.value.relationTokenCanonical, 'to');
    assert.strictEqual(result.value.indirectTarget, tomo);
  });
});
