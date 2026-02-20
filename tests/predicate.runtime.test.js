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
      flags: {
        areaLit: true,
      },
    },
  };

  const room = {
    entityReference: `${areaName}:crypt`,
    area,
    metadata: {
      flags: {
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
        metadata: { flags: {} },
        items: [],
        area: { bundle: 'bundle-test', name: 'actor', metadata: { flags: {} } },
      },
      area: { bundle: 'bundle-test', name: 'actor', metadata: { flags: {} } },
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
          return q.roomFlag('query:crypt', 'slabOpen')
            && q.areaFlag('query', 'areaLit')
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
      metadata: { flags: { slabOpen: true } },
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
        metadata: { flags: { areaLit: true } },
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
      metadata: { flags: {} },
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
