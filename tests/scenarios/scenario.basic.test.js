// @ts-check
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { createScenarioHarness } = require('../../../../util/scenario-test-harness');

// These cases intentionally keep the full CLI/process boundary.
function runScenarioCliSmoke(args) {
  return spawnSync(process.execPath, ['util/scenario-runner.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

let sharedHarnessPromise = null;
let sharedHarnessQueue = Promise.resolve();

function runHarnessScenario(args) {
  if (!sharedHarnessPromise) {
    sharedHarnessPromise = Promise.resolve(createScenarioHarness());
  }

  const scheduled = sharedHarnessQueue.then(async () => {
    const harness = await sharedHarnessPromise;
    return harness.runScenario(args);
  });

  sharedHarnessQueue = scheduled.catch(() => undefined);
  return scheduled;
}

test.after(async () => {
  if (!sharedHarnessPromise) {
    return;
  }

  await sharedHarnessQueue.catch(() => undefined);
  const harness = await sharedHarnessPromise;
  await harness.close();
});

function stripAnsi(text) {
  return String(text).replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-ntqry=><]))/g,
    ''
  );
}

test('scenario runner help exits successfully', () => {
  const result = runScenarioCliSmoke(['--help']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--scenario/);
  assert.match(result.stdout, /--command/);
  assert.match(result.stdout, /--whitespace/);
});

test('scenario runner executes command lines in order and continues on unknown commands', () => {
  const result = runScenarioCliSmoke(['--command', 'unknown-first', '--command', 'unknown-second', '--failOnUnknown']);

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

  const result = runScenarioCliSmoke(['--scenario', scenarioPath, '--failOnUnknown']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /unknown-alpha/);
  assert.match(result.stdout, /What\?/);
  assert.match(result.stdout, /unknown-beta/);
});

test('scenario runner reports error for missing --scenario value', () => {
  const result = runScenarioCliSmoke(['--scenario']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --scenario/);
});

test('scenario runner reports error for missing --command value', () => {
  const result = runScenarioCliSmoke(['--command']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --command/);
});

test('scenario runner reports error for missing --seedInventory value', () => {
  const result = runScenarioCliSmoke(['--seedInventory']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --seedInventory/);
});

test('scenario runner reports error for missing --seedRoomItem value', () => {
  const result = runScenarioCliSmoke(['--seedRoomItem']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --seedRoomItem/);
});

test('scenario runner reports error for unknown .scenario directive', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranvier-scenario-'));
  const scenarioPath = path.join(tmpDir, 'invalid.scenario');
  fs.writeFileSync(scenarioPath, 'unknownDirective: value\n', 'utf8');

  const result = runScenarioCliSmoke(['--scenario', scenarioPath]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown scenario directive "unknownDirective"/);
});

test('scenario runner rejects legacy --commandsFile flag', () => {
  const result = runScenarioCliSmoke(['--commandsFile', 'legacy.commands']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--commandsFile is not supported\. Use --scenario <path>\./);
});

test('scenario runner legacy --command/--args fallback builds one command line', () => {
  const result = runScenarioCliSmoke(['--command', 'legacy-unknown', '--args', 'abc def']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /legacy-unknown abc def/);
  assert.match(result.stdout, /What\?/);
});

test('scenario runner executes via input events and reports unknown text commands', () => {
  const result = runScenarioCliSmoke([
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

test('scenario runner can look in test:lab', async () => {
  const result = await runHarnessScenario([
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

test('scenario runner canonicalizes l to look', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:lab',
    '--command', 'l',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /l/);
  assert.match(result.stdout, /Test Lab/);
  assert.match(result.stdout, /A practice apple rests here\./);
  assert.match(result.stdout, /A practice chest waits here\./);
});

test('scenario runner canonicalizes east to go east', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:labWest',
    '--command', 'east',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /east/);
  assert.match(result.stdout, /look/);
  assert.match(result.stdout, /Test Lab/);
});

test('scenario runner canonicalizes n to go north', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:lab',
    '--command', 'n',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /n/);
  assert.match(result.stdout, /Lab North Walk/);
});

test('scenario runner door-lock scenario validates open travel and re-locked block', () => {
  const result = runScenarioCliSmoke([
    '--scenario', 'bundles/bundle-rantamuta/tests/scenarios/door-lock.scenario',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /The north door is shut and locked\./);
  assert.match(result.stdout, /push north open button/);
  assert.match(result.stdout, /You push the north open button\./);
  assert.match(result.stdout, /The north door opens\./);
  assert.match(result.stdout, /The south doorway stands open from this side as well\./);
  assert.match(result.stdout, /North Door Room/);
  assert.match(result.stdout, /push north close button/);
  assert.match(result.stdout, /You push the north close button\./);
  assert.match(result.stdout, /The north door closes\./);
  assert.match(result.stdout, /The north door is shut and locked\./);
  assert.match(result.stdout, /go north/);
  assert.ok((result.stdout.match(/The way is locked\./g) || []).length >= 2);
});

test('scenario runner virtual-door scenario validates wrong-key failure and virtualized movement flow', () => {
  const result = runScenarioCliSmoke([
    '--scenario', 'bundles/bundle-rantamuta/tests/scenarios/virtual-door.scenario',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Virtual Door South Room/);
  assert.match(result.stdout, /The north door is shut and locked\./);
  assert.match(result.stdout, /unlock north with iron key/);
  assert.match(result.stdout, /does not fit the lock/i);
  assert.match(result.stdout, /You open the north door with the bronze door key\./);
  assert.match(result.stdout, /You lock the north door with the bronze door key\./);
  assert.match(result.stdout, /go north/);
  assert.match(result.stdout, /Virtual Door North Room/);
  assert.match(result.stdout, /The south passage is visibly open\./);
});

test('scenario runner inline-tags scenario resolves room and direct-look tags', () => {
  const result = runScenarioCliSmoke([
    '--scenario', 'bundles/bundle-rantamuta/tests/scenarios/inline-tags.scenario',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Inline Tags Room/);
  assert.match(result.stdout, /Base says bright\./);
  assert.match(result.stdout, /Fragment says bright\./);
  assert.match(result.stdout, /push enable button/);
  assert.match(result.stdout, /Button toggled on\./);
  assert.match(result.stdout, /push disable button/);
  assert.match(result.stdout, /Button toggled off\./);
  assert.equal((result.stdout.match(/Button is pushed\./g) || []).length, 1);
  assert.match(result.stdout, /A lantern glows brightly\./);
  assert.match(result.stdout, /The lantern is open\./);
  assert.doesNotMatch(result.stdout, /\[(bench_always_(true|false)|is_button_pushed):/);
});

test('scenario runner codex gallery exhibit resolves inline tag swaps', () => {
  const result = runScenarioCliSmoke([
    '--scenario', 'bundles/bundle-rantamuta/tests/scenarios/perception-gallery-inline-tags.scenario',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Perception Gallery/);
  assert.match(result.stdout, /put resonant shard/);
  assert.match(result.stdout, /take resonant shard/);
  assert.equal((result.stdout.match(/Shard resonance is in your hands, and the plinth is empty\./g) || []).length, 2);
  assert.equal((result.stdout.match(/Shard resonance is in the gallery, and the plinth is occupied\./g) || []).length, 1);
  assert.doesNotMatch(result.stdout, /\[(does_viewer_hold_resonant_shard|is_resonant_shard_in_gallery):/);
});

test('scenario runner codex Tomo scenario shows caretaker guidance flow', () => {
  const result = runScenarioCliSmoke([
    '--scenario', 'bundles/bundle-rantamuta/tests/scenarios/tomo-bell-courtyard.scenario',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Three offerings wake this tower/i);
  assert.match(result.stdout, /You still need to|Only one offering remains|Start with the reliquary/i);
  assert.match(result.stdout, /descent is open/i);
  assert.match(result.stdout, /Perception Gallery/i);

  const introMatches = result.stdout.match(/Three offerings wake this tower/gi) || [];
  assert.equal(introMatches.length, 1, 'expected Tomo intro line exactly once');
});

test('scenario runner shows asymmetry note in north room when south->north door is closed', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:northDoorRoom',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /North Door Room/);
  assert.match(result.stdout, /The south doorway still looks push-through from here, even while the lock holds from the other side\./);
});

test('scenario runner canonicalizes x <thing> to look <thing>', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:lab',
    '--command', 'x chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /x chest/);
  assert.match(result.stdout, /A lightweight chest meant for put\/take testing\./);
});

test('scenario runner canonicalizes look at <thing> to look <thing>', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:lab',
    '--command', 'look at chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /look at chest/);
  assert.match(result.stdout, /A lightweight chest meant for put\/take testing\./);
});

test('scenario runner traverses lab loop with go and returns to Test Lab', async () => {
  const result = await runHarnessScenario([
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
  const result = runScenarioCliSmoke([
    '--room', 'test:lab',
    '--command', 'get apple',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /get apple/);
  assert.match(result.stdout, /You take the apple\./);
});

test('scenario runner put apple in chest narrates successful put', () => {
  const result = runScenarioCliSmoke([
    '--room', 'test:lab',
    '--command', 'get apple',
    '--command', 'put apple in chest',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /put apple in chest/);
  assert.match(result.stdout, /You put the apple in the chest\./);
});

test('scenario runner inventory shorthand "i" renders inventory output', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:lab',
    '--command', 'i',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /i/);
  assert.match(result.stdout, /You have nothing\./);
});

test('scenario runner routes malformed put relation text to put validation', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:room',
    '--command', 'put in old chest',
    '--failOnUnknown',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /put in old chest/);
  assert.match(result.stdout, /Put what\?/);
});

test('scenario runner non-json output echoes commands and omits diagnostic [run]/[info] lines', async () => {
  const result = await runHarnessScenario([
    '--room', 'test:lab',
    '--command', 'look',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /look/);
  assert.doesNotMatch(result.stdout, /\[run\]/);
  assert.doesNotMatch(result.stdout, /\[info\]/);
});

test('scenario runner --json run event includes parse fields and lookup-based outcome', () => {
  const result = runScenarioCliSmoke([
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
  assert.equal(runEvents[1].lookup.commandFound, true);
  assert.equal(runEvents[1].outcome.code, 'OK');
  assert.equal(runEvents[1].outcome.phase, 'success');

  assert.equal(runEvents[2].parse.intentToken, 'eastward');
  assert.equal(runEvents[2].parse.canonicalInput, 'eastward');
  assert.equal(runEvents[2].outcome.code, 'UNKNOWN_COMMAND');
  assert.equal(runEvents[2].outcome.phase, 'lookup');
});

test('scenario runner --json filters blank and ANSI-only output lines by default', async () => {
  const result = await runHarnessScenario([
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

test('scenario runner --json --whitespace keeps blank and ANSI-only output lines', async () => {
  const result = await runHarnessScenario([
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

  const result = runScenarioCliSmoke(['--json', '--scenario', scenarioPath]);

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
