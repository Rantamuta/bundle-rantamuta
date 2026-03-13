// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('codex actor hook data wiring', function () {
  const codexAreaPath = path.resolve(__dirname, '../areas/codex');
  const npcsPath = path.join(codexAreaPath, 'npcs.yml');
  const roomsPath = path.join(codexAreaPath, 'rooms.yml');

  it('defines the mirror cantor in codex npcs.yml', function () {
    assert.ok(fs.existsSync(npcsPath), 'expected codex npcs.yml to exist');

    const npcsText = fs.readFileSync(npcsPath, 'utf8');
    assert.match(npcsText, /^-\s*id:\s*mirrorCantor\b/m);
    assert.match(npcsText, /^\s*script:\s*mirrorCantor\b/m);
    assert.match(npcsText, /^\s*keywords:\s*\[.*\bmirror\b.*\bcantor\b.*\]/m);
  });

  it('spawns the mirror cantor in codex perception_gallery', function () {
    const roomsText = fs.readFileSync(roomsPath, 'utf8');
    const galleryBlock = roomsText.match(/-\s*id:\s*perception_gallery\b([\s\S]*?)(?:\n-\s*id:|$)/);

    assert.ok(galleryBlock, 'expected perception_gallery room block');

    const blockText = galleryBlock[1];
    assert.match(blockText, /^\s*npcs:\s*$/m);
    assert.match(blockText, /^\s*-\s*codex:mirrorCantor\s*$/m);
  });
});
