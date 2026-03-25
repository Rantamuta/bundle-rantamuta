// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('test area actor hook data wiring', function () {
  const testAreaPath = path.resolve(__dirname, '../areas/test');
  const npcsPath = path.join(testAreaPath, 'npcs.yml');
  const roomsPath = path.join(testAreaPath, 'rooms.yml');
  const conversationPath = path.join(testAreaPath, 'conversations', 'actorPlanner.conversation.yml');
  const runtimeOrderingPath = path.join(testAreaPath, 'conversations', 'runtimeOrdering.conversation.yml');
  const runtimeDefaultPath = path.join(testAreaPath, 'conversations', 'runtimeDefault.conversation.yml');
  const runtimeAutoPath = path.join(testAreaPath, 'conversations', 'runtimeAuto.conversation.yml');
  const runtimeFinalPath = path.join(testAreaPath, 'conversations', 'runtimeFinal.conversation.yml');

  it('defines actor-hook harness NPCs in test npcs.yml', function () {
    assert.ok(fs.existsSync(npcsPath), 'expected test npcs.yml to exist');

    const npcsText = fs.readFileSync(npcsPath, 'utf8');
    assert.match(npcsText, /^-\s*id:\s*actorPlanner\b/m);
    assert.match(npcsText, /^-\s*id:\s*actorGatekeeper\b/m);
    assert.match(npcsText, /^\s*script:\s*actorHookHarness\b/m);
    assert.match(npcsText, /^\s*conversation:\s*conversations\/actorPlanner\.conversation\.yml\b/m);
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

  it('includes the actor planner authored conversation fixture in the test area', function () {
    assert.ok(fs.existsSync(conversationPath), 'expected actor planner conversation fixture to exist');

    const conversationText = fs.readFileSync(conversationPath, 'utf8');
    assert.match(conversationText, /^id:\s*actor_planner\b/m);
    assert.match(conversationText, /^initial:\s*greeting\b/m);
  });

  it('includes runtime conversation fixtures for ordering, default, auto, and final-state behavior', function () {
    assert.ok(fs.existsSync(runtimeOrderingPath), 'expected runtime ordering fixture to exist');
    assert.ok(fs.existsSync(runtimeDefaultPath), 'expected runtime default fixture to exist');
    assert.ok(fs.existsSync(runtimeAutoPath), 'expected runtime auto fixture to exist');
    assert.ok(fs.existsSync(runtimeFinalPath), 'expected runtime final fixture to exist');
  });
});
