// @ts-check
'use strict';

const assert = require('assert');

const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/session/entity-resolution');
const Syntax = require('../lib/session/verb-local-syntax');

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

    assert.deepStrictEqual(compiled, [
      {
        ruleText: 'TEXT to LIVING',
        compiledRuleId: 'say:0',
        atoms: [
          { type: 'slot', kind: 'TEXT' },
          { type: 'literal', value: 'to' },
          { type: 'slot', kind: 'LIVING' },
        ],
      },
      {
        ruleText: 'TEXT',
        compiledRuleId: 'say:1',
        atoms: [
          { type: 'slot', kind: 'TEXT' },
        ],
      },
    ]);
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
