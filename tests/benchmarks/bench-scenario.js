'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { createSuiteResult, printBenchTable } = require('./bench-utils');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BUNDLE_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER_PATH = path.join(ROOT, 'util', 'scenario-runner.js');
const SCENARIO_PATH = path.join(
  BUNDLE_ROOT,
  'tests',
  'scenarios',
  'predicate-bench.scenario'
);

/**
 * @param {string[]} extraArgs
 * @returns {number}
 */
function runScenarioOnce(extraArgs) {
  const args = [RUNNER_PATH, '--scenario', SCENARIO_PATH, ...extraArgs];
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const ended = process.hrtime.bigint();

  if (result.status !== 0) {
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    throw new Error(`scenario-runner failed (status=${result.status})\n${stderr}\n${stdout}`);
  }

  return Number(ended - started);
}

/**
 * @param {string[]} extraArgs
 * @param {number} warmupSamples
 * @param {number} measuredSamples
 * @returns {number[]}
 */
function runCase(extraArgs, warmupSamples, measuredSamples) {
  /** @type {number[]} */
  const samples = [];
  const total = warmupSamples + measuredSamples;

  for (let i = 0; i < total; i += 1) {
    const durationNs = runScenarioOnce(extraArgs);
    if (i < warmupSamples) {
      continue;
    }

    // We benchmark one whole scenario per sample; represent as ns/op directly.
    samples.push(durationNs);
  }

  return samples;
}

function main() {
  const emitJson = process.argv.includes('--json');
  const warmupSamples = 3;
  const measuredSamples = 12;

  const benches = [
    {
      name: 'scenario_plain_output',
      samples: runCase([], warmupSamples, measuredSamples),
    },
    {
      name: 'scenario_json_output',
      samples: runCase(['--json'], warmupSamples, measuredSamples),
    },
  ];

  const result = createSuiteResult('scenario-runner', benches, {
    scenario: path.relative(ROOT, SCENARIO_PATH),
    warmupSamples,
    measuredSamples,
  });

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  console.log('Scenario Benchmark');
  console.log(`scenario=${path.relative(ROOT, SCENARIO_PATH)}`);
  console.log(`samples=${measuredSamples} warmup=${warmupSamples}`);
  printBenchTable(benches);
}

main();
