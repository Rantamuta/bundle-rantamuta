// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('test area actor hook data wiring', function () {
  const testAreaPath = path.resolve(__dirname, '../areas/test');
  const npcsPath = path.join(testAreaPath, 'npcs.yml');
  const roomsPath = path.join(testAreaPath, 'rooms.yml');

  it('defines actor-hook harness NPCs in test npcs.yml', function () {
    assert.ok(fs.existsSync(npcsPath), 'expected test npcs.yml to exist');

    const npcsText = fs.readFileSync(npcsPath, 'utf8');
    assert.match(npcsText, /^-\s*id:\s*actorPlanner\b/m);
    assert.match(npcsText, /^-\s*id:\s*actorGatekeeper\b/m);
    assert.match(npcsText, /^\s*script:\s*actorHookHarness\b/m);
  });

  it('spawns the actor-hook harness NPCs in the test actorHooks room', function () {
    const roomsText = fs.readFileSync(roomsPath, 'utf8');
    const roomBlock = roomsText.match(/-\s*id:\s*actorHooks\b([\s\S]*?)(?:\n-\s*id:|$)/);

    assert.ok(roomBlock, 'expected actorHooks room block');

    const blockText = roomBlock[1];
    assert.match(blockText, /^\s*npcs:\s*$/m);
    assert.match(blockText, /^\s*-\s*test:actorPlanner\s*$/m);
    assert.match(blockText, /^\s*-\s*test:actorGatekeeper\s*$/m);
  });
});
