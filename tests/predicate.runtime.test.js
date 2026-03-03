// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPredicateRuntime } = require('../lib/helpers/predicate-runtime');

/**
 * @param {string} root
 * @param {string} bundle
 * @param {string} area
 * @param {string} source
 */
function writePredicates(root, bundle, area, source) {
  const areaPath = path.join(root, bundle, 'areas', area);
  fs.mkdirSync(areaPath, { recursive: true });
  fs.writeFileSync(path.join(areaPath, 'predicates.js'), source, 'utf8');
}

/**
 * @param {string} areaName
 * @param {Record<string, *>} [overrides]
 */
function makeRenderContext(areaName, overrides = {}) {
  const area = {
    bundle: 'bundle-test',
    name: areaName,
    metadata: {
      values: {
        areaLit: true,
      },
    },
  };

  const room = {
    entityReference: `${areaName}:crypt`,
    area,
    metadata: {
      values: {
        slabOpen: true,
      },
    },
    items: [],
  };

  const world = {
    RoomManager: {
      getRoom: (roomRef) => roomRef === `${areaName}:crypt` ? room : null,
    },
    AreaManager: {
      getArea: (name) => name === areaName ? area : null,
      getAreaByReference: (areaRef) => areaRef === areaName ? area : null,
    },
    ItemManager: {
      items: new Set(),
    },
  };

  return {
    actor: null,
    room,
    area,
    world,
    source: 'room.description',
    ...overrides,
  };
}

describe('bundle-rantamuta predicate runtime', function () {
  /** @type {string[]} */
  const tempRoots = [];

  afterEach(function () {
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('evaluates only strict true as passing and warns once for non-boolean return', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'stateful',
      `module.exports = {
        strictTrue: () => true,
        strictFalse: () => false,
        truthyValue: () => 1,
      };`
    );

    const warnings = [];
    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: message => warnings.push(String(message)),
        error: () => {},
      },
    });

    const context = makeRenderContext('stateful');

    assert.strictEqual(runtime.evaluate('strictTrue', context), true);
    assert.strictEqual(runtime.evaluate('strictFalse', context), false);
    assert.strictEqual(runtime.evaluate('truthyValue', context), false);
    assert.strictEqual(runtime.evaluate('truthyValue', context), false);

    const invalidReturnWarnings = warnings.filter(line => line.includes('PREDICATE_INVALID_RETURN') || line.includes('non-boolean'));
    assert.strictEqual(invalidReturnWarnings.length, 1);
  });

  it('returns false and warns once when predicate is missing', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'missing',
      `module.exports = {
        exists: () => true,
      };`
    );

    const warnings = [];
    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: message => warnings.push(String(message)),
        error: () => {},
      },
    });

    const context = makeRenderContext('missing', { source: 'room.fragment' });

    assert.strictEqual(runtime.evaluate('doesNotExist', context), false);
    assert.strictEqual(runtime.evaluate('doesNotExist', context), false);

    const missingWarnings = warnings.filter(line => line.includes('PREDICATE_MISSING') || line.includes('not found'));
    assert.strictEqual(missingWarnings.length, 1);
  });

  it('returns false and warns once when predicate throws', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'throws',
      `module.exports = {
        boom: () => { throw new Error('boom'); },
      };`
    );

    const warnings = [];
    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: message => warnings.push(String(message)),
        error: () => {},
      },
    });

    const context = makeRenderContext('throws', { source: 'room.description' });

    assert.strictEqual(runtime.evaluate('boom', context), false);
    assert.strictEqual(runtime.evaluate('boom', context), false);

    const throwWarnings = warnings.filter(line => line.includes('PREDICATE_THROW') || line.includes('threw'));
    assert.strictEqual(throwWarnings.length, 1);
  });

  it('passes normalized read-only actor view and read-only context to predicates', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'actor',
      `module.exports = {
        actorShape: ({ actor, context }) => {
          return Object.isFrozen(actor)
            && Object.isFrozen(context)
            && actor.ref === 'player:rendall'
            && actor.name === 'Rendall'
            && actor.level === 7
            && actor.role === 2
            && actor.roomRef === 'actor:crypt'
            && Array.isArray(actor.effectIds)
            && actor.effectIds.includes('blessed')
            && !Object.prototype.hasOwnProperty.call(actor, 'inventory')
            && context.source === 'room.description'
            && context.areaRef === 'actor'
            && context.roomRef === 'actor:crypt';
        },
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const actor = {
      ref: 'player:rendall',
      name: 'Rendall',
      level: 7,
      role: 2,
      room: { entityReference: 'actor:crypt' },
      effects: ['blessed'],
      inventory: [{ entityReference: 'actor:secret' }],
    };

    const context = makeRenderContext('actor', {
      actor,
      room: {
        entityReference: 'actor:crypt',
        metadata: { values: {} },
        items: [],
        area: { bundle: 'bundle-test', name: 'actor', metadata: { values: {} } },
      },
      area: { bundle: 'bundle-test', name: 'actor', metadata: { values: {} } },
    });

    assert.strictEqual(runtime.evaluate('actorShape', context), true);
  });

  it('supports read-only q facade methods and returns false for actor-scoped q calls when actor is null', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'query',
      `module.exports = {
        queryChecks: ({ q }) => {
          return typeof q.roomFlag === 'undefined'
            && typeof q.areaFlag === 'undefined'
            && q.getRoomMetadata('query:crypt', 'slabOpen') === true
            && q.getAreaMetadata('query', 'areaLit') === true
            && q.getWorldMetadata('queryState.phase') === 2
            && q.getAreaMetadata('query', 'StoryArc.PHASE') === 2
            && q.getAreaMetadata('query', 'STORYARC.zeroValue') === 0
            && q.getAreaMetadata('query', 'storyArc.NULLVALUE') === null
            && q.getAreaMetadata('query', 'storyArc.MISSINGVALUE') === undefined
            && q.getWorldMetadata('querystate.zeroValue') === 0
            && q.getWorldMetadata('queryState.nullValue') === null
            && q.getWorldMetadata('queryState.MISSINGVALUE') === undefined
            && q.getWorldMetadata('') === undefined
            && q.getRoomMetadata('query:crypt', 'LOCKS.innerDoor') === false
            && q.getRoomMetadata('query:crypt', 'locks.MISSINGDOOR') === undefined
            && q.roomHasItem('query:crypt', 'query:coin')
            && q.currentContainerHasItem('query:prayerStone')
            && q.roomContainerHasItem('query:crypt', 'query:stoneBasin', 'query:prayerStone')
            && q.actorHasItem('query:key')
            && q.actorHasEffect('blessed')
            && q.actorQuestActive('query:questA')
            && q.actorQuestCompleted('query:questB')
            && !q.isDoorClosed('north')
            && !q.isDoorLocked('north')
            && !q.isDoorClosedBetween('query:crypt', 'query:hall')
            && !q.isDoorLockedBetween('query:crypt', 'query:hall');
        },
        nullActorChecks: ({ q }) => {
          return !q.actorHasItem('query:key')
            && !q.actorHasEffect('blessed')
            && !q.actorQuestActive('query:questA')
            && !q.actorQuestCompleted('query:questB');
        },
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const basin = {
      entityReference: 'query:stoneBasin',
      inventory: [{ entityReference: 'query:prayerStone' }],
    };

    const room = {
      entityReference: 'query:crypt',
      metadata: {
        values: {
          slabOpen: true,
          locks: {
            innerDoor: false,
          },
        },
      },
      items: [
        { entityReference: 'query:coin' },
        basin,
      ],
      exits: [
        { direction: 'north', roomId: 'query:hall' },
        { direction: 'south', roomId: 'query:ante' },
      ],
      getDoor(fromRoom) {
        if (fromRoom && fromRoom.entityReference === 'query:ante') {
          return { closed: false, locked: false };
        }
        return null;
      },
      area: {
        bundle: 'bundle-test',
        name: 'query',
        metadata: {
          values: {
            areaLit: true,
            storyArc: {
              phase: 2,
              zeroValue: 0,
              nullValue: null,
            },
          },
        },
      },
    };

    const actor = {
      effects: ['blessed'],
      inventory: [{ entityReference: 'query:key' }],
      quests: {
        active: ['query:questA'],
        completed: ['query:questB'],
      },
    };

    const world = {
      RoomManager: {
        getRoom: (roomRef) => {
          if (roomRef === 'query:crypt') {
            return room;
          }

          if (roomRef === 'query:hall') {
            return {
              entityReference: 'query:hall',
              getDoor(fromRoom) {
                if (fromRoom && fromRoom.entityReference === 'query:crypt') {
                  return { closed: false, locked: false };
                }
                return null;
              },
            };
          }

          if (roomRef === 'query:ante') {
            return { entityReference: 'query:ante' };
          }

          return null;
        },
      },
      AreaManager: {
        getAreaByReference: (areaRef) => areaRef === 'query' ? room.area : null,
        getArea: (name) => name === 'query' ? room.area : null,
      },
      ItemManager: {
        items: new Set(room.items),
      },
      metadata: {
        values: {
          queryState: {
            phase: 2,
            zeroValue: 0,
            nullValue: null,
          },
        },
      },
    };

    assert.strictEqual(runtime.evaluate('queryChecks', {
      actor,
      room,
      area: room.area,
      world,
      currentContainer: basin,
      source: 'room.fragment',
    }), true);

    assert.strictEqual(runtime.evaluate('nullActorChecks', {
      actor: null,
      room,
      area: room.area,
      world,
      source: 'room.fragment',
    }), true);
  });

  it('does not expose legacy q.*Flag helpers and does not read metadata.flags fallback', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'legacy_flags',
      `module.exports = {
        legacyFlagChecks: ({ q }) => (
          typeof q.roomFlag === 'undefined'
          && typeof q.areaFlag === 'undefined'
          && q.getRoomMetadata('legacy_flags:crypt', 'slabOpen') === undefined
          && q.getAreaMetadata('legacy_flags', 'areaLit') === undefined
          && q.getWorldMetadata('worldLit') === undefined
        ),
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const area = {
      bundle: 'bundle-test',
      name: 'legacy_flags',
      metadata: {
        flags: { areaLit: true },
      },
    };

    const room = {
      entityReference: 'legacy_flags:crypt',
      area,
      metadata: {
        flags: { slabOpen: true },
      },
      items: [],
      exits: [],
    };

    const world = {
      RoomManager: {
        getRoom: roomRef => roomRef === 'legacy_flags:crypt' ? room : null,
      },
      AreaManager: {
        getAreaByReference: areaRef => areaRef === 'legacy_flags' ? area : null,
        getArea: name => name === 'legacy_flags' ? area : null,
      },
      ItemManager: {
        items: new Set(),
      },
      metadata: {
        flags: { worldLit: true },
      },
    };

    assert.strictEqual(runtime.evaluate('legacyFlagChecks', {
      actor: null,
      room,
      area,
      world,
      source: 'room.description',
    }), true);
  });

  it('warns on case-collision path matches and reads the last matched value', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'collision',
      `module.exports = {
        collisionChecks: ({ q }) => (
          q.getAreaMetadata('collision', 'storyarc.phase') === 2
          && q.getRoomMetadata('collision:crypt', 'locks.innerdoor') === true
          && q.getWorldMetadata('storyarc.phase') === 4
        ),
      };`
    );

    const warnings = [];
    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: message => warnings.push(String(message)),
        error: () => {},
      },
    });

    const area = {
      bundle: 'bundle-test',
      name: 'collision',
      metadata: {
        values: {
          storyArc: { phase: 1 },
          StoryArc: { phase: 2 },
        },
      },
    };

    const room = {
      entityReference: 'collision:crypt',
      area,
      metadata: {
        values: {
          locks: { innerDoor: false },
          LOCKS: { innerDoor: true },
        },
      },
      items: [],
      exits: [],
    };

    const world = {
      RoomManager: {
        getRoom: roomRef => roomRef === 'collision:crypt' ? room : null,
      },
      AreaManager: {
        getAreaByReference: areaRef => areaRef === 'collision' ? area : null,
        getArea: name => name === 'collision' ? area : null,
      },
      ItemManager: {
        items: new Set(),
      },
      metadata: {
        values: {
          storyArc: { phase: 3 },
          StoryArc: { phase: 4 },
        },
      },
    };

    assert.strictEqual(runtime.evaluate('collisionChecks', {
      actor: null,
      room,
      area,
      world,
      source: 'room.description',
    }), true);

    assert.strictEqual(runtime.evaluate('collisionChecks', {
      actor: null,
      room,
      area,
      world,
      source: 'room.description',
    }), true);

    const collisionWarnings = warnings.filter(line => line.includes('PREDICATE_QUERY_METADATA_KEY_COLLISION'));
    assert.strictEqual(collisionWarnings.length, 3);
    const worldCollisionWarnings = collisionWarnings.filter(line => (
      line.includes('PREDICATE_QUERY_METADATA_KEY_COLLISION:getWorldMetadata:world:storyarc')
      && line.includes('q.getWorldMetadata("storyarc.phase")')
    ));
    assert.strictEqual(worldCollisionWarnings.length, 1);
  });

  it('reads metadata values for booleans and non-booleans through q.get*Metadata', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'compat_values',
      `module.exports = {
        valuesFirstChecks: ({ q }) => (
          typeof q.roomFlag === 'undefined'
          && typeof q.areaFlag === 'undefined'
          && q.getRoomMetadata('compat_values:crypt', 'slabOpen') === false
          && q.getAreaMetadata('compat_values', 'areaLit') === true
          && q.getWorldMetadata('worldLit') === true
          && q.getRoomMetadata('compat_values:crypt', 'nonBoolean') === 'yes'
          && q.getWorldMetadata('worldNonBoolean') === 'yes'
          && q.getRoomMetadata('compat_values:crypt', 'legacyOnly') === undefined
          && q.getRoomMetadata('compat_values:crypt', 'legacy_key') === true
          && q.getAreaMetadata('compat_values', 'legacy_key') === true
          && q.getWorldMetadata('legacy_key') === true
        ),
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const area = {
      bundle: 'bundle-test',
      name: 'compat_values',
      metadata: {
        values: {
          areaLit: true,
          legacy_key: true,
        },
      },
    };

    const room = {
      entityReference: 'compat_values:crypt',
      area,
      metadata: {
        values: {
          slabOpen: false,
          nonBoolean: 'yes',
          legacy_key: true,
        },
      },
      items: [],
      exits: [],
    };

    const world = {
      RoomManager: {
        getRoom: roomRef => roomRef === 'compat_values:crypt' ? room : null,
      },
      AreaManager: {
        getAreaByReference: areaRef => areaRef === 'compat_values' ? area : null,
        getArea: name => name === 'compat_values' ? area : null,
      },
      ItemManager: {
        items: new Set(),
      },
      metadata: {
        values: {
          worldLit: true,
          worldNonBoolean: 'yes',
          legacy_key: true,
        },
      },
    };

    assert.strictEqual(runtime.evaluate('valuesFirstChecks', {
      actor: null,
      room,
      area,
      world,
      source: 'room.description',
    }), true);
  });

  it('returns undefined for missing world metadata context or roots', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'world_missing',
      `module.exports = {
        worldMissingChecks: ({ q }) => (
          q.getWorldMetadata('story.phase') === undefined
          && q.getWorldMetadata('') === undefined
        ),
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const baseContext = makeRenderContext('world_missing');

    assert.strictEqual(runtime.evaluate('worldMissingChecks', {
      ...baseContext,
      world: null,
      source: 'room.description',
    }), true);

    assert.strictEqual(runtime.evaluate('worldMissingChecks', {
      ...baseContext,
      world: {},
      source: 'room.description',
    }), true);

    assert.strictEqual(runtime.evaluate('worldMissingChecks', {
      ...baseContext,
      world: { metadata: 12 },
      source: 'room.description',
    }), true);

    assert.strictEqual(runtime.evaluate('worldMissingChecks', {
      ...baseContext,
      world: { metadata: { values: 12 } },
      source: 'room.description',
    }), true);
  });

  it('uses virtual-door effective state for virtualized room pairs', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'virtual',
      `module.exports = {
        virtualDoorChecks: ({ q }) => {
          return q.isDoorClosed('north')
            && q.isDoorLocked('north')
            && q.isDoorClosedBetween('virtual:a', 'virtual:b')
            && q.isDoorLockedBetween('virtual:a', 'virtual:b');
        },
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const area = {
      bundle: 'bundle-test',
      name: 'virtual',
      metadata: { values: {} },
    };

    const roomA = {
      entityReference: 'virtual:a',
      area,
      exits: [{ direction: 'north', roomId: 'virtual:b' }],
      doors: new Map([
        ['virtual:b', { closed: true, locked: true }],
      ]),
      getExits() {
        return this.exits;
      },
      getDoor(fromRoom) {
        return this.doors.get(fromRoom && fromRoom.entityReference) || null;
      },
    };

    const roomB = {
      entityReference: 'virtual:b',
      area,
      exits: [{ direction: 'south', roomId: 'virtual:a' }],
      doors: new Map([
        // Deliberately "open" on this side so directional-only outbound reads would be false.
        ['virtual:a', { closed: false, locked: false }],
      ]),
      getExits() {
        return this.exits;
      },
      getDoor(fromRoom) {
        return this.doors.get(fromRoom && fromRoom.entityReference) || null;
      },
    };

    const world = {
      RoomManager: {
        rooms: new Map([
          [roomA.entityReference, roomA],
          [roomB.entityReference, roomB],
        ]),
        getRoom(roomRef) {
          return this.rooms.get(roomRef) || null;
        },
      },
      AreaManager: {
        getAreaByReference: areaRef => areaRef === 'virtual' ? area : null,
        getArea: name => name === 'virtual' ? area : null,
      },
      ItemManager: {
        items: new Set(),
      },
    };

    assert.strictEqual(runtime.evaluate('virtualDoorChecks', {
      actor: null,
      room: roomA,
      area,
      world,
      source: 'room.fragment',
    }), true);
  });

  it('uses directional door state for non-virtual room pairs', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'nonvirtual',
      `module.exports = {
        directionalDoorChecks: ({ q }) => {
          return !q.isDoorClosed('north')
            && !q.isDoorLocked('north')
            && !q.isDoorClosedBetween('nonvirtual:a', 'nonvirtual:b')
            && !q.isDoorLockedBetween('nonvirtual:a', 'nonvirtual:b')
            && q.isDoorClosedBetween('nonvirtual:b', 'nonvirtual:a')
            && q.isDoorLockedBetween('nonvirtual:b', 'nonvirtual:a');
        },
      };`
    );

    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: () => {},
      },
    });

    const area = {
      bundle: 'bundle-test',
      name: 'nonvirtual',
      metadata: { values: {} },
    };

    const roomA = {
      entityReference: 'nonvirtual:a',
      area,
      exits: [{ direction: 'north', roomId: 'nonvirtual:b', virtualDoor: false }],
      doors: new Map([
        ['nonvirtual:b', { closed: true, locked: true }],
      ]),
      getExits() {
        return this.exits;
      },
      getDoor(fromRoom) {
        return this.doors.get(fromRoom && fromRoom.entityReference) || null;
      },
    };

    const roomB = {
      entityReference: 'nonvirtual:b',
      area,
      exits: [{ direction: 'south', roomId: 'nonvirtual:a' }],
      doors: new Map([
        ['nonvirtual:a', { closed: false, locked: false }],
      ]),
      getExits() {
        return this.exits;
      },
      getDoor(fromRoom) {
        return this.doors.get(fromRoom && fromRoom.entityReference) || null;
      },
    };

    const world = {
      RoomManager: {
        rooms: new Map([
          [roomA.entityReference, roomA],
          [roomB.entityReference, roomB],
        ]),
        getRoom(roomRef) {
          return this.rooms.get(roomRef) || null;
        },
      },
      AreaManager: {
        getAreaByReference: areaRef => areaRef === 'nonvirtual' ? area : null,
        getArea: name => name === 'nonvirtual' ? area : null,
      },
      ItemManager: {
        items: new Set(),
      },
    };

    assert.strictEqual(runtime.evaluate('directionalDoorChecks', {
      actor: null,
      room: roomA,
      area,
      world,
      source: 'room.fragment',
    }), true);
  });

  it('returns false and warns once for unresolvable door query input', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'querywarn',
      `module.exports = {
        unresolvedDoorQueries: ({ q }) => {
          return !q.isDoorClosed('north')
            && !q.isDoorLocked('north')
            && !q.isDoorClosedBetween('', 'querywarn:hall')
            && !q.isDoorLockedBetween('querywarn:crypt', '');
        },
      };`
    );

    const warnings = [];
    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: message => warnings.push(String(message)),
        error: () => {},
      },
    });

    const context = makeRenderContext('querywarn', {
      source: 'room.fragment',
    });

    assert.strictEqual(runtime.evaluate('unresolvedDoorQueries', context), true);
    assert.strictEqual(runtime.evaluate('unresolvedDoorQueries', context), true);

    const queryWarnings = warnings.filter(line => line.includes('Predicate query q.isDoor'));
    assert.strictEqual(queryWarnings.length, 4);
  });

  it('ignores invalid registry exports and returns false', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-runtime-'));
    tempRoots.push(tempRoot);

    writePredicates(
      tempRoot,
      'bundle-test',
      'invalid',
      `module.exports = () => true;`
    );

    const errors = [];
    const runtime = createPredicateRuntime({
      bundlesRootPath: tempRoot,
      logger: {
        warn: () => {},
        error: message => errors.push(String(message)),
      },
    });

    const context = makeRenderContext('invalid');

    assert.strictEqual(runtime.evaluate('anyPredicate', context), false);
    assert.ok(errors.some(line => line.includes('must export an object map')));
  });
});
