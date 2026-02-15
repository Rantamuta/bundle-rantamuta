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

function stripAnsi(text) {
  return String(text).replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-ntqry=><]))/g,
    ''
  );
}

test('scenario runner help exits successfully', () => {
  const result = runScenario(['--help']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--scenario/);
  assert.match(result.stdout, /--command/);
  assert.match(result.stdout, /--whitespace/);
});

test('scenario runner executes command lines in order and continues on unknown commands', () => {
  const result = runScenario(['--command', 'unknown-first', '--command', 'unknown-second', '--failOnUnknown']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /unknown-first/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /unknown-second/);
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
  assert.match(result.stdout, /unknown-alpha/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /unknown-beta/);
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
  assert.match(result.stdout, /legacy-unknown abc def/);
  assert.match(result.stdout, /What\?/);
});

test('scenario runner executes via input events and reports unknown text commands', () => {
  const result = runScenario([
    '--room', 'test:room',
    '--command', 'look',
    '--command', 'eastward',
    '--failOnUnknown',
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /look/);
  assert.match(result.stdout, /Test Room/);
  assert.match(result.stdout, /eastward/);
  assert.match(result.stdout, /What\?/);
});

test('scenario runner can look in test:lab', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /look/);
  assert.match(result.stdout, /Test Lab/);
  assert.match(result.stdout, /Exits: north, west/);
  assert.match(result.stdout, /A practice apple rests here\./);
  assert.match(result.stdout, /A practice chest waits here\./);
});

test('scenario runner canonicalizes l to look', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'l',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /l/);
  assert.match(result.stdout, /Test Lab/);
  assert.match(result.stdout, /A practice apple rests here\./);
  assert.match(result.stdout, /A practice chest waits here\./);
});

test('scenario runner canonicalizes east to go east', () => {
  const result = runScenario([
    '--room', 'test:labWest',
    '--command', 'east',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /east/);
  assert.match(result.stdout, /look/);
  assert.match(result.stdout, /Test Lab/);
});

test('scenario runner canonicalizes n to go north', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'n',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /n/);
  assert.match(result.stdout, /Lab North Walk/);
});

test('scenario runner canonicalizes x <thing> to look <thing>', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'x chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /x chest/);
  assert.match(result.stdout, /A lightweight chest meant for put\/take testing\./);
});

test('scenario runner canonicalizes look at <thing> to look <thing>', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'look at chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /look at chest/);
  assert.match(result.stdout, /A lightweight chest meant for put\/take testing\./);
});

test('scenario runner traverses lab loop with go and returns to Test Lab', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'go north',
    '--command', 'go west',
    '--command', 'go south',
    '--command', 'go east',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /go north/);
  assert.match(result.stdout, /go west/);
  assert.match(result.stdout, /go south/);
  assert.match(result.stdout, /go east/);
  assert.match(result.stdout, /look/);
  assert.match(result.stdout, /Test Lab/);
});

test('scenario runner get apple narrates successful take', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'get apple',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /get apple/);
  assert.match(result.stdout, /You take the apple\./);
});

test('scenario runner put apple in chest narrates successful put', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'get apple',
    '--command', 'put apple in chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /put apple in chest/);
  assert.match(result.stdout, /You put the apple in the chest\./);
});

test('scenario runner inventory shorthand "i" renders inventory output', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'i',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /i/);
  assert.match(result.stdout, /You have nothing\./);
});

test('scenario runner routes malformed put relation text to put validation', () => {
  const result = runScenario([
    '--room', 'test:room',
    '--command', 'put in old chest',
    '--failOnUnknown',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /put in old chest/);
  assert.match(result.stdout, /Put what\?/);
});

test('scenario runner non-json output echoes commands and omits diagnostic [run]/[info] lines', () => {
  const result = runScenario([
    '--room', 'test:lab',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /look/);
  assert.doesNotMatch(result.stdout, /\[run\]/);
  assert.doesNotMatch(result.stdout, /\[info\]/);
});

test('scenario runner --json run event includes parse fields and outcome phase/code', () => {
  const result = runScenario([
    '--json',
    '--room', 'test:room',
    '--command', 'l',
    '--command', 'put',
    '--command', 'eastward',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const runEvents = payload.events.filter(event => event.type === 'run');
  assert.equal(runEvents.length, 3);

  assert.equal(runEvents[0].parse.intentToken, 'look');
  assert.equal(runEvents[0].parse.canonicalInput, 'look');
  assert.equal(runEvents[0].outcome.code, 'OK');
  assert.equal(runEvents[0].outcome.phase, 'success');

  assert.equal(runEvents[1].parse.intentToken, 'put');
  assert.equal(runEvents[1].parse.canonicalInput, 'put');
  assert.equal(runEvents[1].outcome.code, 'FORM_MISSING_DIRECT');
  assert.equal(runEvents[1].outcome.phase, 'entityResolution');

  assert.equal(runEvents[2].parse.intentToken, 'eastward');
  assert.equal(runEvents[2].parse.canonicalInput, 'eastward');
  assert.equal(runEvents[2].outcome.code, 'UNKNOWN_COMMAND');
  assert.equal(runEvents[2].outcome.phase, 'lookup');
});

test('scenario runner --json filters blank and ANSI-only output lines by default', () => {
  const result = runScenario([
    '--json',
    '--room', 'test:room',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const outputEvents = payload.events.filter(event => event.type === 'output');
  assert.ok(outputEvents.length > 0);
  for (const event of outputEvents) {
    const text = String(event.text);
    assert.notEqual(stripAnsi(text).trim(), '');
  }
});

test('scenario runner --json --whitespace keeps blank and ANSI-only output lines', () => {
  const result = runScenario([
    '--json',
    '--whitespace',
    '--room', 'test:room',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const outputEvents = payload.events.filter(event => event.type === 'output');
  assert.ok(outputEvents.length > 0);
  assert.ok(outputEvents.some(event => stripAnsi(String(event.text)).trim() === ''));
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
