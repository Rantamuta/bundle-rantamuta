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
});
