// @ts-check
'use strict';

const assert = require('assert');
const { inspect } = require('util');
const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/session/entity-resolution');

function formatActual(value) {
  return inspect(value, {
    depth: null,
    colors: false,
    compact: false,
    sorted: true,
  });
}

function assertResultOk(result, description) {
  assert.ok(
    result && result.ok,
    `${description}\nactual result: ${formatActual(result)}`
  );
}

function assertResultDeepEqual(result, expected, description) {
  assert.deepStrictEqual(
    result,
    expected,
    `${description}\nactual result: ${formatActual(result)}`
  );
}

function assertErrorCode(result, expectedCode, description) {
  assert.strictEqual(
    result && result.ok,
    false,
    `${description}\nexpected failure result, got: ${formatActual(result)}`
  );
  if (result.ok) {
    return;
  }

  assert.strictEqual(
    result.error && result.error.code,
    expectedCode,
    `${description}\nactual result: ${formatActual(result)}`
  );
}

function makeCommand(def) {
  const metadata = {};

  if (Array.isArray(def && def.syntaxRules)) {
    metadata.syntaxRules = def.syntaxRules;
  }

  if (def && def.rules && typeof def.rules === 'object') {
    metadata.entityResolution = {
      rules: def.rules,
    };
  }

  return {
    metadata,
  };
}

function createItem(def = {}) {
  return {
    uuid: def.uuid || `${String(def.name || 'item').replace(/\s+/gu, '-')}-${Math.random()}`,
    name: def.name || 'item',
    keywords: def.keywords || [],
    metadata: def.metadata || {},
    inventory: def.inventory || null,
    closed: !!def.closed,
    locked: !!def.locked,
    isEquipped: !!def.isEquipped,
  };
}

function createContainer(def = {}) {
  const inventory = def.inventory || new Map();
  return createItem({
    ...def,
    inventory,
  });
}

function createDetail(def = {}) {
  return {
    id: def.id || String(def.name || 'detail').replace(/\s+/gu, '-'),
    name: def.name || 'detail',
    keywords: def.keywords || [],
    description: def.description || null,
    verbs: def.verbs,
    metadata: def.metadata || {},
  };
}

function createPlayer(def = {}) {
  const inventoryItems = Array.isArray(def.inventoryItems) ? def.inventoryItems : [];
  const roomItems = Array.isArray(def.roomItems) ? def.roomItems : [];
  const room = def.room || {
    items: new Set(roomItems),
  };

  return {
    inventory: new Map(inventoryItems.map(item => [item.uuid, item])),
    room,
    sendCalls: [],
    send(line) {
      this.sendCalls.push(line);
    },
  };
}

describe('bundle-rantamuta entity-resolution', function () {
  it('returns FORM_MISSING_DIRECT for directIndirect command form without direct span', function () {
    const command = makeCommand({
      syntaxRules: ['ENTITY in ENTITY'],
      rules: {
        directIndirect: {
          acceptedRelations: ['in', 'into'],
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ roomItems: [createContainer({ name: 'old chest', keywords: ['old', 'chest'] })] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('put in old chest'));

    assertResultDeepEqual(result, {
      ok: false,
      error: {
        code: 'FORM_MISSING_DIRECT',
      },
    }, 'expected missing direct error for directIndirect form without a direct span');
  });

  it('normalizes relation token into canonical relation token', function () {
    const sword = createItem({ uuid: 'sword-1', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = createContainer({ uuid: 'chest-1', name: 'old chest', keywords: ['old', 'chest'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY into ENTITY'],
      rules: {
        directIndirect: {
          acceptedRelations: ['in'],
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('put rusty sword into old chest'));

    assertResultOk(result, 'expected successful entity resolution for "put rusty sword into old chest"');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.relationTokenRaw, 'into');
    assert.strictEqual(result.value.relationTokenCanonical, 'in');
    assert.strictEqual(result.value.directTarget, sword);
    assert.strictEqual(result.value.indirectTarget, chest);
  });

  it('returns FORM_UNSUPPORTED_RELATION when relation is not accepted', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY in ENTITY'],
      rules: {
        directIndirect: {
          acceptedRelations: ['in'],
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('put rusty sword on old chest'));

    assert.strictEqual(result.ok, false, `expected unsupported relation failure, got: ${formatActual(result)}`);
    if (result.ok) {
      return;
    }

    assert.strictEqual(
      result.error.code,
      'FORM_UNSUPPORTED_RELATION',
      `expected FORM_UNSUPPORTED_RELATION, got: ${formatActual(result)}`
    );
  });

  it('allows unresolved indirect binding when rule opts in via allowUnresolvedIndirect', function () {
    const sword = createItem({ uuid: 'sword-1', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY with ENTITY'],
      rules: {
        directIndirect: {
          acceptedRelations: ['with'],
          allowUnresolvedIndirect: true,
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['player.inventory'],
          },
        },
      },
    });
    const player = createPlayer({ inventoryItems: [sword] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('unlock rusty sword with missing key'));

    assertResultOk(result, 'expected unresolved indirect binding to be preserved when allowUnresolvedIndirect is enabled');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.ruleKey, 'directIndirect');
    assert.strictEqual(result.value.directTarget, sword);
    assert.strictEqual(result.value.indirectTarget, undefined);
    assert.strictEqual(result.value.indirectResolutionError.code, 'TARGET_NOT_FOUND');
  });

  it('keeps failing unresolved indirect binding when allowUnresolvedIndirect is not enabled', function () {
    const sword = createItem({ uuid: 'sword-1', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY with ENTITY'],
      rules: {
        directIndirect: {
          acceptedRelations: ['with'],
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['player.inventory'],
          },
        },
      },
    });
    const player = createPlayer({ inventoryItems: [sword] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('unlock rusty sword with missing key'));

    assert.strictEqual(result.ok, false, `expected unresolved indirect binding failure, got: ${formatActual(result)}`);
    if (result.ok) {
      return;
    }

    assert.strictEqual(
      result.error.code,
      'TARGET_NOT_FOUND',
      `expected TARGET_NOT_FOUND for unresolved indirect binding, got: ${formatActual(result)}`
    );
  });

  it('supports intransitive offramp with empty bindings', function () {
    const command = makeCommand({
      syntaxRules: ['(empty)'],
      rules: {
        intransitive: {},
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('sing'));

    assertResultOk(result, 'expected intransitive offramp to succeed with empty bindings');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.ruleKey, 'intransitive');
    assert.strictEqual(result.value.directTarget, undefined);
    assert.strictEqual(result.value.indirectTarget, undefined);
  });

  it('returns FORM_MISSING_DIRECT for intransitive input when verb declares direct rule', function () {
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('take'));

    assertResultDeepEqual(result, {
      ok: false,
      error: {
        code: 'FORM_MISSING_DIRECT',
      },
    }, 'expected missing direct error for intransitive input against a direct rule');
  });

  it('returns FORM_MISSING_DIRECT for intransitive input when verb declares directIndirect rule', function () {
    const command = makeCommand({
      syntaxRules: ['ENTITY in ENTITY'],
      rules: {
        directIndirect: {
          acceptedRelations: ['in'],
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('put'));

    assertResultDeepEqual(result, {
      ok: false,
      error: {
        code: 'FORM_MISSING_DIRECT',
      },
    }, 'expected missing direct error for intransitive input against a directIndirect rule');
  });

  it('returns FORM_MISSING_RELATION for intransitive input when verb declares indirect rule', function () {
    const command = makeCommand({
      syntaxRules: ['to ENTITY'],
      rules: {
        indirect: {
          acceptedRelations: ['to'],
          scopeProfile: {
            indirect: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('sing'));

    assertResultDeepEqual(result, {
      ok: false,
      error: {
        code: 'FORM_MISSING_RELATION',
      },
    }, 'expected missing relation error for intransitive input against an indirect rule');
  });

  it('returns FORM_MISSING_RELATION for intransitive input when verb declares relationOnly rule', function () {
    const command = makeCommand({
      syntaxRules: ['off'],
      rules: {
        relationOnly: {
          acceptedRelations: ['off'],
        },
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('keep'));

    assertResultDeepEqual(result, {
      ok: false,
      error: {
        code: 'FORM_MISSING_RELATION',
      },
    }, 'expected missing relation error for intransitive input against a relationOnly rule');
  });

  it('returns FORM_NOT_SUPPORTED for intransitive input when no compatible rule exists', function () {
    const command = makeCommand({
      rules: {},
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('foo'));

    assert.strictEqual(result.ok, false, `expected unsupported form failure, got: ${formatActual(result)}`);
    if (result.ok) {
      return;
    }

    assert.strictEqual(
      result.error.code,
      'FORM_NOT_SUPPORTED',
      `expected FORM_NOT_SUPPORTED, got: ${formatActual(result)}`
    );
  });

  it('supports relationOnly rule shape with relation canonicalization', function () {
    const command = makeCommand({
      syntaxRules: ['off'],
      rules: {
        relationOnly: {
          acceptedRelations: ['off'],
        },
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('keep off'));

    assertResultOk(result, 'expected relationOnly rule shape to resolve successfully');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.ruleKey, 'relationOnly');
    assert.strictEqual(result.value.relationTokenRaw, 'off');
    assert.strictEqual(result.value.relationTokenCanonical, 'off');
    assert.strictEqual(result.value.directTarget, undefined);
    assert.strictEqual(result.value.indirectTarget, undefined);
  });

  it('supports indirect rule shape (relation + indirect target, no direct target)', function () {
    const baby = createItem({ uuid: 'baby-1', name: 'baby', keywords: ['baby'] });
    const command = makeCommand({
      syntaxRules: ['to ENTITY'],
      rules: {
        indirect: {
          acceptedRelations: ['to'],
          scopeProfile: {
            indirect: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ roomItems: [baby] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('sing to baby'));

    assertResultOk(result, 'expected indirect rule shape to resolve successfully');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.ruleKey, 'indirect');
    assert.strictEqual(result.value.directTarget, undefined);
    assert.strictEqual(result.value.indirectTarget, baby);
    assert.strictEqual(result.value.relationTokenRaw, 'to');
    assert.strictEqual(result.value.relationTokenCanonical, 'to');
  });

  it('fails declaration validation when relation-bearing rule omits acceptedRelations', function () {
    const command = makeCommand({
      rules: {
        relationOnly: {},
      },
    });
    const player = createPlayer();

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('keep off'));

    assert.strictEqual(result.ok, false, `expected invalid acceptedRelations failure, got: ${formatActual(result)}`);
    if (result.ok) {
      return;
    }

    assert.strictEqual(
      result.error.code,
      'FORM_NOT_SUPPORTED',
      `expected FORM_NOT_SUPPORTED for invalid acceptedRelations, got: ${formatActual(result)}`
    );
    assert.deepStrictEqual(result.error.details, {
      reason: 'INVALID_ACCEPTED_RELATIONS',
      ruleKey: 'relationOnly',
    });
  });

  it('resolves direct target by declared scope order', function () {
    const fromInventory = createItem({ uuid: 'inv-sword', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const fromRoom = createItem({ uuid: 'room-sword', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['player.inventory', 'room.items'],
          },
        },
      },
    });
    const player = createPlayer({
      inventoryItems: [fromInventory],
      roomItems: [fromRoom],
    });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('take rusty sword'));

    assertResultOk(result, 'expected direct target resolution by declared scope order to succeed');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.directTarget, fromInventory);
  });

  it('resolves direct target from room.details scope', function () {
    const bellShrine = createDetail({
      id: 'bell_shrine',
      name: 'bell-shrine',
      keywords: ['bell-shrine', 'shrine', 'bell'],
      description: 'The weathered shrine is veined with old cracks.',
    });
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.details'],
          },
        },
      },
    });
    const room = {
      items: new Set(),
      metadata: {
        details: [bellShrine],
      },
      entityReference: 'test:detail_room',
    };
    const player = createPlayer({ room });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('look shrine'));

    assertResultOk(result, 'expected room.details direct target resolution to succeed');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.directTarget.kind, 'roomDetail');
    assert.strictEqual(result.value.directTarget.detailId, 'bell_shrine');
    assert.strictEqual(result.value.directTarget.name, 'bell-shrine');
  });

  it('prefers room items over room details when both match', function () {
    const roomSword = createItem({ uuid: 'room-sword', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const swordDetail = createDetail({
      id: 'sword_relief',
      name: 'sword',
      keywords: ['sword', 'relief'],
      description: 'A carved sword motif is set into the wall.',
    });
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.items', 'room.details'],
          },
        },
      },
    });
    const room = {
      items: new Set([roomSword]),
      metadata: {
        details: [swordDetail],
      },
      entityReference: 'test:mix_room',
    };
    const player = createPlayer({ room });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('look sword'));

    assertResultOk(result, 'expected room items to win over room details when declared first');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.directTarget, roomSword);
  });

  it('prefers room details over inventory when scope declares details first', function () {
    const carriedSword = createItem({ uuid: 'inv-sword', name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const roomDetail = createDetail({
      id: 'sword_relief',
      name: 'sword',
      keywords: ['sword'],
      description: 'An engraved sword appears on the stone relief.',
    });
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.details', 'player.inventory'],
          },
        },
      },
    });
    const room = {
      items: new Set(),
      metadata: {
        details: [roomDetail],
      },
      entityReference: 'test:detail_first_room',
    };
    const player = createPlayer({
      room,
      inventoryItems: [carriedSword],
    });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('look sword'));

    assertResultOk(result, 'expected room details to win over inventory when declared first');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.directTarget.kind, 'roomDetail');
    assert.strictEqual(result.value.directTarget.detailId, 'sword_relief');
  });

  it('resolves go direction via room.exits scope', function () {
    const command = makeCommand({
      syntaxRules: ['EXIT'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.exits'],
          },
        },
      },
    });
    const room = {
      items: new Set(),
      getExits: () => ([
        { direction: 'east', roomId: 'test:labNorth' },
        { direction: 'west', roomId: 'test:labWest' },
      ]),
    };
    const player = createPlayer({ room });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('go east'));

    assertResultOk(result, 'expected room.exits direction resolution to succeed');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.directTarget.direction, 'east');
    assert.strictEqual(result.value.directTarget.roomId, 'test:labNorth');
    assert.strictEqual(result.value.directTarget.name, 'east');
    assert.strictEqual(result.value.directTarget.uuid, 'exit:east:test:labNorth:0');
  });

  it('resolves direct target from room.npcs scope', function () {
    const tomo = {
      uuid: 'npc-tomo',
      name: 'Bell Keeper Tomo',
      keywords: ['tomo', 'keeper', 'bell', 'caretaker'],
      isNpc: true,
    };
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.npcs'],
          },
        },
      },
    });
    const player = createPlayer({
      room: {
        items: new Set(),
        npcs: new Set([tomo]),
      },
    });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('look tomo'));

    assertResultOk(result, 'expected room.npcs direct target resolution to succeed');
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.directTarget, tomo);
  });

  it('uses exact direction matching for room.exits scope', function () {
    const command = makeCommand({
      syntaxRules: ['EXIT'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.exits'],
          },
        },
      },
    });
    const room = {
      items: new Set(),
      getExits: () => ([{ direction: 'east', roomId: 'test:labNorth' }]),
    };
    const player = createPlayer({ room });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('go e'));

    assert.strictEqual(result.ok, false, `expected exact room.exits match failure for shorthand direction, got: ${formatActual(result)}`);
    if (result.ok) {
      return;
    }

    assert.strictEqual(
      result.error.code,
      'TARGET_NOT_FOUND',
      `expected TARGET_NOT_FOUND for shorthand exit direction, got: ${formatActual(result)}`
    );
    assert.deepStrictEqual(result.error.details, { role: 'direct' });
  });

  it('uses bounded breadth-first traversal with max depth', function () {
    const coin = createItem({ uuid: 'deep-coin', name: 'gold coin', keywords: ['gold', 'coin'] });
    const inner = createContainer({ uuid: 'inner', name: 'inner box', keywords: ['inner', 'box'], inventory: new Map([[coin.uuid, coin]]) });
    const outer = createContainer({ uuid: 'outer', name: 'outer box', keywords: ['outer', 'box'], inventory: new Map([[inner.uuid, inner]]) });
    const player = createPlayer({ roomItems: [outer] });

    const shallowCommand = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: [{ source: 'room.items', nested: true, maxDepth: 1 }],
          },
        },
      },
    });
    const deepCommand = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: [{ source: 'room.items', nested: true, maxDepth: 2 }],
          },
        },
      },
    });

    const shallowResult = EntityResolution.resolveEntityContext({}, shallowCommand, player, parseInput('take coin'));
    assert.strictEqual(shallowResult.ok, false, `expected shallow traversal to fail, got: ${formatActual(shallowResult)}`);
    if (!shallowResult.ok) {
      assert.strictEqual(
        shallowResult.error.code,
        'TARGET_NOT_FOUND',
        `expected TARGET_NOT_FOUND for shallow traversal miss, got: ${formatActual(shallowResult)}`
      );
    }

    const deepResult = EntityResolution.resolveEntityContext({}, deepCommand, player, parseInput('take coin'));
    assertResultOk(deepResult, 'expected deep traversal to resolve the nested target');
    if (!deepResult.ok) {
      return;
    }

    assert.strictEqual(deepResult.value.directTarget, coin);
  });

  it('resolves nested targets from player.inventory when nested traversal is enabled', function () {
    const coin = createItem({ uuid: 'inv-coin', name: 'gold coin', keywords: ['gold', 'coin'] });
    const satchel = createContainer({
      uuid: 'inv-satchel',
      name: 'leather satchel',
      keywords: ['leather', 'satchel'],
      inventory: new Map([[coin.uuid, coin]]),
    });
    const player = createPlayer({ inventoryItems: [satchel] });

    const flatCommand = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['player.inventory'],
          },
        },
      },
    });
    const nestedCommand = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: [{ source: 'player.inventory', nested: true }],
          },
        },
      },
    });

    const flatResult = EntityResolution.resolveEntityContext({}, flatCommand, player, parseInput('take coin'));
    assert.strictEqual(flatResult.ok, false, `expected flat inventory traversal to fail, got: ${formatActual(flatResult)}`);
    if (!flatResult.ok) {
      assert.strictEqual(
        flatResult.error.code,
        'TARGET_NOT_FOUND',
        `expected TARGET_NOT_FOUND for flat inventory traversal miss, got: ${formatActual(flatResult)}`
      );
    }

    const nestedResult = EntityResolution.resolveEntityContext({}, nestedCommand, player, parseInput('take coin'));
    assertResultOk(nestedResult, 'expected nested inventory traversal to resolve the target');
    if (!nestedResult.ok) {
      return;
    }

    assert.strictEqual(nestedResult.value.directTarget, coin);
  });

  it('returns AMBIGUOUS_TARGET for distinguishable matches', function () {
    const green = createItem({
      uuid: 'env-green',
      name: 'envelope',
      keywords: ['envelope'],
      metadata: { resolution: { disambiguationLabel: 'large, green envelope' } },
    });
    const blue = createItem({
      uuid: 'env-blue',
      name: 'envelope',
      keywords: ['envelope'],
      metadata: { resolution: { disambiguationLabel: 'large, blue envelope' } },
    });

    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ roomItems: [green, blue] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('take envelope'));

    assert.strictEqual(result.ok, false, `expected ambiguous target failure, got: ${formatActual(result)}`);
    if (result.ok) {
      return;
    }

    assert.strictEqual(
      result.error.code,
      'AMBIGUOUS_TARGET',
      `expected AMBIGUOUS_TARGET, got: ${formatActual(result)}`
    );
    assert.strictEqual(result.error.details.role, 'direct');
    assert.strictEqual(result.error.details.compiledRuleId, 'take:0');
    assert.strictEqual(result.error.details.matchedRuleText, 'ENTITY');
    assert.ok(Array.isArray(result.error.details.ambiguity));
    assert.strictEqual(result.error.details.ambiguity.length, 1);
    assert.strictEqual(result.error.details.ambiguity[0].role, 'direct');
    assert.strictEqual(result.error.details.ambiguity[0].surface, 'envelope');
  });

  it('auto-picks deterministically for indistinguishable matches', function () {
    const appleOne = createItem({ uuid: 'apple-2', name: 'apple', keywords: ['apple'] });
    const appleTwo = createItem({ uuid: 'apple-1', name: 'apple', keywords: ['apple'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ roomItems: [appleOne, appleTwo] });

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('take apple'));

    assertResultOk(result, 'expected deterministic auto-pick for indistinguishable matches');
    if (!result.ok) {
      return;
    }

    // declaration/enumeration order wins before UUID lexical order
    assert.strictEqual(result.value.directTarget, appleOne);
  });

  it('does not mutate containers or emit player-visible output', function () {
    const calls = [];
    const coin = createItem({ uuid: 'coin-1', name: 'coin', keywords: ['coin'] });
    const command = makeCommand({
      syntaxRules: ['ENTITY'],
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.items'],
          },
        },
      },
    });
    const player = createPlayer({ roomItems: [coin] });

    coin.addItem = () => { calls.push('addItem'); };
    coin.removeItem = () => { calls.push('removeItem'); };

    const result = EntityResolution.resolveEntityContext({}, command, player, parseInput('take coin'));

    assertResultOk(result, 'expected entity resolution to succeed without mutating containers or emitting output');
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(player.sendCalls, []);
  });
});
