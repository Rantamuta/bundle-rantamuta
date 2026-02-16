// @ts-check
'use strict';

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

test('bell tower puzzle runs successfully end to end', () => {
  const result = runScenario([
    '--json',
    '--scenario', 'bundles/bundle-rantamuta/tests/scenarios/bell-tower.scenario',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  /** @type {{meta: {commands: number, unknown: number, failed: number}, events: Array<Record<string, *>>}} */
  const payload = JSON.parse(result.stdout);
  assert.ok(payload && typeof payload === 'object');
  assert.equal(payload.meta.unknown, 0);
  assert.equal(payload.meta.failed, 0);
  assert.ok(payload.meta.commands > 0);

  const runEvents = payload.events.filter(event => event.type === 'run');
  assert.equal(runEvents.length, payload.meta.commands);

  const northRun = runEvents.find(event => event.raw === 'n');
  assert.ok(northRun);
  assert.equal(northRun.parse.canonicalInput, 'go north');

  const examineReliquaryRun = runEvents.find(event => event.raw === 'x reliquary');
  assert.ok(examineReliquaryRun);
  assert.equal(examineReliquaryRun.parse.canonicalInput, 'look reliquary');

  const downRun = runEvents.find(event => event.raw === 'down');
  assert.ok(downRun);
  assert.equal(downRun.parse.canonicalInput, 'go down');

  const ritualCompletionRun = runEvents.find(event => event.raw === 'put bronze clapper in cracked bell');
  assert.ok(ritualCompletionRun);
  assert.ok(ritualCompletionRun.phases);
  assert.equal(ritualCompletionRun.phases.render.ok, true);
  assert.equal(ritualCompletionRun.phases.render.failures, 0);
  assert.ok(Number(ritualCompletionRun.phases.render.instructionsAttempted) >= 1);

  const outputText = payload.events
    .filter(event => event.type === 'output')
    .map(event => stripAnsi(String(event.text)))
    .join('\n');

  assert.match(outputText, /An ornate reliquary with a shallow circular recess awaiting its seal\./);
  assert.match(outputText, /An ornate reliquary with a red wax seal set firmly into its shallow recess\./);
  assert.match(outputText, /The seal is set into the reliquary\. Removing it would break the rite\./);
  assert.match(outputText, /Ancient runes curl around the basin lip, each line cut with unnerving precision\./);
  assert.match(outputText, /Ancient runes curl around the basin lip, now lit by an ethereal glow that wavers like breath\./);
  assert.match(outputText, /The basin holds the stone as if in quiet guardianship\. You cannot remove it\./);
  assert.match(outputText, /The old bell is split along one side, and its clapper is missing\./);
  assert.match(outputText, /The old bell is split along one side, but a bronze clapper now hangs within it\./);
  assert.match(outputText, /The clapper is locked into position\. Removing it would undo the balance\./);
  assert.match(outputText, /A low, resonant hum fills the tower, wavering at its edges before steadying\./);
  assert.match(outputText, /There is a low grinding sound from the base of the bell tower\./);
  assert.match(outputText, /A heavy slab has been forced aside, revealing stone stairs descending into darkness\./);
  assert.match(outputText, /Resonance Chamber/);
});
