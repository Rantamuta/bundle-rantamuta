'use strict';

const assert = require('assert');

const { createQueryFacade } = require('../lib/helpers/query-facade');

describe('bundle-rantamuta query facade', function () {
  it('exports the shared read-only q facade factory', function () {
    assert.strictEqual(typeof createQueryFacade, 'function');
  });

  it('supports the actor-scoped query methods used by conversation conditions', function () {
    const actor = {
      inventory: [{ entityReference: 'test:brassKey' }],
      effects: ['focus'],
      quests: {
        active: ['test:activeQuest'],
        completed: [{ id: 'test:doneQuest' }],
      },
    };
    const q = createQueryFacade({
      actor,
      room: null,
      area: null,
      world: null,
      entity: null,
      currentContainer: null,
    });

    assert.strictEqual(q.actorHasItem('test:brassKey'), true);
    assert.strictEqual(q.actorHasEffect('focus'), true);
    assert.strictEqual(q.actorQuestActive('test:activeQuest'), true);
    assert.strictEqual(q.actorQuestCompleted('test:doneQuest'), true);
    assert.strictEqual(q.actorHasItem('test:missing'), false);
  });

  it('supports metadata and room item query methods with existing predicate semantics', function () {
    const room = {
      entityReference: 'test:start',
      metadata: { values: { Story: { Phase: 2 } } },
      items: [{ entityReference: 'test:apple' }],
    };
    const area = {
      name: 'test',
      metadata: { values: { Flags: { Ready: true } } },
    };
    const world = {
      metadata: { values: { World: { Ready: true } } },
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === 'test:start' ? room : null;
        },
      },
      AreaManager: {
        getAreaByReference(areaRef) {
          return areaRef === 'test' ? area : null;
        },
      },
    };
    const q = createQueryFacade({
      actor: null,
      room,
      area,
      world,
      entity: null,
      currentContainer: null,
    });

    assert.strictEqual(q.getRoomMetadata('test:start', 'story.phase'), 2);
    assert.strictEqual(q.getAreaMetadata('test', 'flags.ready'), true);
    assert.strictEqual(q.getWorldMetadata('world.ready'), true);
    assert.strictEqual(q.roomHasItem('test:start', 'test:apple'), true);
  });
});
