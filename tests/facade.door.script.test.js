// @ts-check
'use strict';

const assert = require('assert');
const facadeDoorScript = require('../areas/rantamuta/scripts/items/facadeDoor');

describe('bundle-rantamuta facadeDoor item script', function () {
  it('attaches canDirect and planDirect hooks to the matching exit on spawn', function () {
    const matchingExit = { direction: 'north', roomId: 'test:observatoryFoyer' };
    const otherExit = { direction: 'east', roomId: 'test:market' };
    const item = {
      metadata: {
        facadeDoor: {
          roomId: 'test:observatoryFoyer',
          direction: 'north',
        },
      },
      room: {
        exits: [matchingExit, otherExit],
      },
    };

    const onSpawn = facadeDoorScript.listeners.spawn({});
    onSpawn.call(item);

    assert.strictEqual(typeof matchingExit.canDirect, 'function');
    assert.strictEqual(typeof matchingExit.planDirect, 'function');
    assert.strictEqual(otherExit.canDirect, undefined);
    assert.strictEqual(otherExit.planDirect, undefined);
  });

  it('emits semantic success render from exit planDirect for go', function () {
    const matchingExit = { direction: 'north', roomId: 'test:observatoryFoyer' };
    const item = {
      metadata: {
        facadeDoor: {
          roomId: 'test:observatoryFoyer',
          direction: 'north',
          flavor: {
            go: '{actor.You} {verb:slip} through the iris gate.',
          },
        },
      },
      room: {
        exits: [matchingExit],
      },
    };

    const onSpawn = facadeDoorScript.listeners.spawn({});
    onSpawn.call(item);

    const contribution = matchingExit.planDirect(
      { name: 'Tester' },
      'go',
      {
        entityResolution: {
          directTarget: matchingExit,
        },
      }
    );

    assert.ok(contribution && typeof contribution === 'object');
    assert.ok(contribution.render && Array.isArray(contribution.render.messages));
    assert.deepStrictEqual(contribution.render.messages[0], {
      type: 'semanticEvent',
      template: '{actor.You} {verb:slip} through the iris gate.',
      audiencePolicy: 'self_and_others',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
      objectText: {
        direct: 'brass iris gate',
      },
    });
  });
});
