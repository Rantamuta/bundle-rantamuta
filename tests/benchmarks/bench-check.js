'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { formatNs } = require('./bench-utils');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_BASELINE_PATH = path.join(__dirname, 'predicate-baseline.json');

const SUITES = [
  {
    id: 'predicate-runtime',
    script: 'bench-predicate-runtime.js',
    thresholdFraction: 0.35,
    minDeltaNs: 250,
  },
  {
    id: 'room-view',
    script: 'bench-room-view.js',
    thresholdFraction: 0.30,
    minDeltaNs: 1000,
  },
  {
    id: 'scenario-runner',
    script: 'bench-scenario.js',
    thresholdFraction: 0.25,
    minDeltaNs: 20_000_000,
  },
];

/**
 * Reads a simple `--key value` CLI argument.
 * @param {string} key
 * @returns {string | null}
 */
function readArgValue(key) {
  const args = process.argv.slice(2);
  const index = args.indexOf(key);
  if (index === -1 || index + 1 >= args.length) {
    return null;
  }

  return args[index + 1];
}

/**
 * Bench scripts may print logs around JSON; parse from the last valid JSON line.
 * @param {string} rawStdout
 * @returns {*}
 */
function parseJsonFromOutput(rawStdout) {
  const lines = rawStdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_error) {
      // Keep scanning for the JSON line.
    }
  }

  throw new Error('Could not find JSON benchmark output.');
}

/**
 * Executes a benchmark suite script and returns its JSON payload.
 * @param {{ id: string, script: string }} suite
 * @returns {*}
 */
function runSuite(suite) {
  const scriptPath = path.join(__dirname, suite.script);
  const result = spawnSync(process.execPath, [scriptPath, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(
      `Failed to run ${suite.id} benchmark.\n` +
      `status=${result.status}\n` +
      `stderr=${stderr || '(empty)'}\n` +
      `stdout=${stdout || '(empty)'}`
    );
  }

  return parseJsonFromOutput(result.stdout || '');
}

/**
 * @param {Array<{ name: string }>} values
 * @returns {Map<string, *>}
 */
function indexByName(values) {
  const output = new Map();
  for (const value of values || []) {
    if (value && typeof value.name === 'string') {
      output.set(value.name, value);
    }
  }

  return output;
}

/**
 * Compares one suite against its baseline and identifies regressions and structural mismatches.
 * @param {*} baselineSuite
 * @param {*} currentSuite
 * @param {{ thresholdFraction: number, minDeltaNs: number }} config
 * @returns {{
 *   regressions: Array<{ caseName: string, baselineMean: number, currentMean: number, delta: number, ratio: number }>,
 *   missingCases: string[],
 *   addedCases: string[],
 * }}
 */
function compareSuite(baselineSuite, currentSuite, config) {
  const baselineCases = indexByName(baselineSuite.cases);
  const currentCases = indexByName(currentSuite.cases);
  const regressions = [];
  const missingCases = [];
  const addedCases = [];

  for (const caseName of baselineCases.keys()) {
    if (!currentCases.has(caseName)) {
      missingCases.push(caseName);
      continue;
    }

    const baselineMean = Number(baselineCases.get(caseName).stats.mean || 0);
    const currentMean = Number(currentCases.get(caseName).stats.mean || 0);
    if (baselineMean <= 0) {
      continue;
    }

    const delta = currentMean - baselineMean;
    const ratio = delta / baselineMean;
    const isRegression = delta > config.minDeltaNs && ratio > config.thresholdFraction;
    if (isRegression) {
      regressions.push({ caseName, baselineMean, currentMean, delta, ratio });
    }
  }

  for (const caseName of currentCases.keys()) {
    if (!baselineCases.has(caseName)) {
      addedCases.push(caseName);
    }
  }

  return { regressions, missingCases, addedCases };
}

/**
 * @param {string} value
 * @returns {number}
 */
function parseMajor(value) {
  const match = String(value || '').match(/v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function main() {
  const baselineArg = readArgValue('--baseline');
  const baselinePath = baselineArg ? path.resolve(ROOT, baselineArg) : DEFAULT_BASELINE_PATH;

  if (!fs.existsSync(baselinePath)) {
    console.error('Performance baseline not found.');
    console.error(`Expected file: ${path.relative(ROOT, baselinePath)}`);
    console.error('Run `npm run bench:record` first, then re-run `npm run bench:check`.');
    process.exit(1);
  }

  /** @type {*} */
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const baselineSuites = new Map((baseline.suites || []).map(suite => [suite.suite, suite]));

  const currentSuites = SUITES.map(runSuite);
  const failures = [];

  const baselineNodeMajor = parseMajor(baseline.host && baseline.host.node);
  const currentNodeMajor = parseMajor(process.version);
  if (baselineNodeMajor !== currentNodeMajor) {
    console.warn(
      `Warning: baseline was recorded on Node ${baseline.host && baseline.host.node},` +
      ` current run is ${process.version}.`
    );
    console.warn('Node major version differences can shift benchmark timings.');
  }

  for (const suiteConfig of SUITES) {
    const baselineSuite = baselineSuites.get(suiteConfig.id);
    const currentSuite = currentSuites.find(suite => suite.suite === suiteConfig.id);

    if (!baselineSuite) {
      failures.push({
        type: 'missing-suite',
        suite: suiteConfig.id,
        message: `Suite "${suiteConfig.id}" is missing from baseline.`,
      });
      continue;
    }

    if (!currentSuite) {
      failures.push({
        type: 'missing-suite-run',
        suite: suiteConfig.id,
        message: `Suite "${suiteConfig.id}" did not produce current results.`,
      });
      continue;
    }

    const comparison = compareSuite(baselineSuite, currentSuite, suiteConfig);
    for (const regression of comparison.regressions) {
      failures.push({
        type: 'regression',
        suite: suiteConfig.id,
        ...regression,
        thresholdFraction: suiteConfig.thresholdFraction,
        minDeltaNs: suiteConfig.minDeltaNs,
      });
    }

    for (const caseName of comparison.missingCases) {
      failures.push({
        type: 'missing-case',
        suite: suiteConfig.id,
        message: `Case "${caseName}" exists in baseline but not in current results.`,
      });
    }

    for (const caseName of comparison.addedCases) {
      failures.push({
        type: 'added-case',
        suite: suiteConfig.id,
        message: `Case "${caseName}" is new and has no baseline entry yet.`,
      });
    }
  }

  const baselineRelative = path.relative(ROOT, baselinePath);
  if (!failures.length) {
    console.log('Predicate performance check passed.');
    console.log(`Compared against baseline: ${baselineRelative}`);
    console.log('No regressions exceeded suite thresholds.');
    process.exit(0);
  }

  console.error('Predicate performance check failed.');
  console.error(`Compared against baseline: ${baselineRelative}`);

  for (const failure of failures) {
    if (failure.type === 'regression') {
      const percent = (failure.ratio * 100).toFixed(1);
      const thresholdPercent = (failure.thresholdFraction * 100).toFixed(0);
      console.error(
        `- [${failure.suite}] ${failure.caseName}: mean +${percent}% ` +
        `(${formatNs(failure.delta)} slower; baseline ${formatNs(failure.baselineMean)} -> current ${formatNs(failure.currentMean)}).`
      );
      console.error(
        `  Threshold is >${thresholdPercent}% and >${formatNs(failure.minDeltaNs)} absolute increase.`
      );
      continue;
    }

    console.error(`- [${failure.suite}] ${failure.message}`);
  }

  console.error('');
  console.error('What this usually means:');
  console.error('1. A code path became more expensive for this benchmark case.');
  console.error('2. The machine was under different load (CPU scaling, other processes, thermal throttling).');
  console.error('3. The behavior changed intentionally, and the baseline now needs to be refreshed.');
  console.error('');
  console.error('Suggested next steps:');
  console.error('1. Re-run `npm run bench:check` once to rule out transient machine noise.');
  console.error('2. If it still fails, run `npm run bench:all` and inspect which cases moved.');
  console.error('3. If the slowdown is expected and accepted, run `npm run bench:record` and commit the updated baseline.');

  process.exit(1);
}

main();
