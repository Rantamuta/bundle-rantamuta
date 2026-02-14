// @ts-check
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');

function runScenario(args) {
  return spawnSync(process.execPath, ['util/scenario-runner.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('scenario runner help exits successfully', () => {
  const result = runScenario(['--help']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--scenario/);
  assert.match(result.stdout, /--command/);
});

test('scenario runner executes command lines in order and continues on unknown commands', () => {
  const result = runScenario(['--command', 'unknown-first', '--command', 'unknown-second', '--failOnUnknown']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[info\] scenario starting \(commands=2\)/);
  assert.match(result.stdout, /\[run\] 1\/2: unknown-first/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /\[run\] 2\/2: unknown-second/);
  assert.match(result.stdout, /\[info\] scenario complete \(commands=2, unknown=2, failed=1\)/);
});

test('scenario runner .scenario file parses directives and ignores comments/blank lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranvier-scenario-'));
  const scenarioPath = path.join(tmpDir, 'test.scenario');

  fs.writeFileSync(
    scenarioPath,
    '# comment\n\ncommand: unknown-alpha\n\nseedInventory: test:rustySword\n# another\ncommand: unknown-beta\n',
    'utf8'
  );

  const result = runScenario(['--scenario', scenarioPath, '--failOnUnknown']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[info\] scenario starting \(commands=2\)/);
  assert.match(result.stdout, /\[run\] 1\/2: unknown-alpha/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /\[run\] 2\/2: unknown-beta/);
  assert.match(result.stdout, /\[info\] scenario complete \(commands=2, unknown=2, failed=1\)/);
});

test('scenario runner reports error for missing --scenario value', () => {
  const result = runScenario(['--scenario']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --scenario/);
});

test('scenario runner reports error for missing --command value', () => {
  const result = runScenario(['--command']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --command/);
});

test('scenario runner reports error for missing --seedInventory value', () => {
  const result = runScenario(['--seedInventory']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --seedInventory/);
});

test('scenario runner reports error for missing --seedRoomItem value', () => {
  const result = runScenario(['--seedRoomItem']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --seedRoomItem/);
});

test('scenario runner reports error for unknown .scenario directive', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranvier-scenario-'));
  const scenarioPath = path.join(tmpDir, 'invalid.scenario');
  fs.writeFileSync(scenarioPath, 'unknownDirective: value\n', 'utf8');

  const result = runScenario(['--scenario', scenarioPath]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown scenario directive "unknownDirective"/);
});

test('scenario runner rejects legacy --commandsFile flag', () => {
  const result = runScenario(['--commandsFile', 'legacy.commands']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--commandsFile is not supported\. Use --scenario <path>\./);
});

test('scenario runner legacy --command/--args fallback builds one command line', () => {
  const result = runScenario(['--command', 'legacy-unknown', '--args', 'abc def']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[info\] scenario starting \(commands=1\)/);
  assert.match(result.stdout, /\[run\] 1\/1: legacy-unknown abc def/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /\[info\] scenario complete \(commands=1, unknown=1, failed=0\)/);
});

test('scenario runner --throughInput executes via input events and reports unknown text commands', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:room',
    '--command', 'look',
    '--command', 'east',
    '--failOnUnknown',
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /\[info\] scenario starting \(commands=2\)/);
  assert.match(result.stdout, /\[run\] 1\/2: look/);
  assert.match(result.stdout, /Test Room/);
  assert.match(result.stdout, /\[run\] 2\/2: east/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /\[info\] scenario complete \(commands=2, unknown=1, failed=1\)/);
});

test('scenario runner --throughInput can look in test:lab', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:lab',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[run\] 1\/1: look/);
  assert.match(result.stdout, /Test Lab/);
  assert.match(result.stdout, /A practice apple rests here\./);
  assert.match(result.stdout, /A practice chest waits here\./);
});

test('scenario runner --throughInput traverses lab loop with go and returns to Test Lab', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:lab',
    '--command', 'go north',
    '--command', 'go west',
    '--command', 'go south',
    '--command', 'go east',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[run\] 1\/5: go north/);
  assert.match(result.stdout, /\[run\] 2\/5: go west/);
  assert.match(result.stdout, /\[run\] 3\/5: go south/);
  assert.match(result.stdout, /\[run\] 4\/5: go east/);
  assert.match(result.stdout, /\[run\] 5\/5: look/);
  assert.match(result.stdout, /Test Lab/);
});

test('scenario runner --throughInput get apple narrates successful take', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:lab',
    '--command', 'get apple',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[run\] 1\/1: get apple/);
  assert.match(result.stdout, /You take the apple\./);
});

test('scenario runner --throughInput put apple in chest narrates successful put', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:lab',
    '--command', 'get apple',
    '--command', 'put apple in chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[run\] 2\/2: put apple in chest/);
  assert.match(result.stdout, /You put the apple in the chest\./);
});

test('scenario runner --throughInput inventory shorthand "i" renders inventory output', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:lab',
    '--command', 'i',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[run\] 1\/1: i/);
  assert.match(result.stdout, /You have nothing\./);
});

test('scenario runner --throughInput routes malformed put relation text to put validation', () => {
  const result = runScenario([
    '--throughInput',
    '--room', 'test:room',
    '--command', 'put in old chest',
    '--failOnUnknown',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[run\] 1\/1: put in old chest/);
  assert.match(result.stdout, /Put what\?/);
  assert.match(result.stdout, /\[info\] scenario complete \(commands=1, unknown=0, failed=0\)/);
});

test('scenario runner seeds inventory and room items before command execution', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranvier-scenario-'));
  const scenarioPath = path.join(tmpDir, 'seed.scenario');
  fs.writeFileSync(
    scenarioPath,
    [
      'room: test:room',
      'seedInventory: test:rustySword',
      'seedRoomItem: test:oldChest',
      'command: look',
      '',
    ].join('\n'),
    'utf8'
  );

  const result = runScenario(['--json', '--scenario', scenarioPath]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const seedEvents = payload.events.filter(event => event.type === 'seed');

  assert.equal(seedEvents.length, 2);
  assert.deepEqual(seedEvents[0], {
    type: 'seed',
    scope: 'inventory',
    entityReference: 'test:rustySword',
    itemName: 'rusty sword',
  });
  assert.deepEqual(seedEvents[1], {
    type: 'seed',
    scope: 'room',
    entityReference: 'test:oldChest',
    itemName: 'old chest',
    room: 'test:room',
  });
});
