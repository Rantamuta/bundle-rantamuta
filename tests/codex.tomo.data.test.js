// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('codex Tomo data wiring', function () {
  const codexAreaPath = path.resolve(__dirname, '../areas/codex');
  const npcsPath = path.join(codexAreaPath, 'npcs.yml');
  const roomsPath = path.join(codexAreaPath, 'rooms.yml');

  it('defines Tomo in codex npcs.yml', function () {
    assert.ok(fs.existsSync(npcsPath), 'expected codex npcs.yml to exist');

    const npcsText = fs.readFileSync(npcsPath, 'utf8');
    assert.match(npcsText, /^-\s*id:\s*tomo\b/m);
    assert.match(npcsText, /^\s*script:\s*tomoCaretaker\b/m);
    assert.match(npcsText, /^\s*keywords:\s*\[.*\btomo\b.*\]/m);
  });

  it('spawns Tomo in codex bell_courtyard', function () {
    const roomsText = fs.readFileSync(roomsPath, 'utf8');

    const bellCourtyardBlock = roomsText.match(/-\s*id:\s*bell_courtyard\b([\s\S]*?)(?:\n-\s*id:|$)/);
    assert.ok(bellCourtyardBlock, 'expected bell_courtyard room block');

    const blockText = bellCourtyardBlock[1];
    assert.match(blockText, /^\s*npcs:\s*$/m);
    assert.match(blockText, /^\s*-\s*codex:tomo\s*$/m);
  });
});
