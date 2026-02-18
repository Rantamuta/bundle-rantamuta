'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_BASELINE_PATH = path.join(__dirname, 'predicate-baseline.json');
const SUITES = [
  { id: 'predicate-runtime', script: 'bench-predicate-runtime.js' },
  { id: 'room-view', script: 'bench-room-view.js' },
  { id: 'scenario-runner', script: 'bench-scenario.js' },
];

/**
 * Reads a simple `--key value` CLI argument. Used so baseline location can be overridden in CI/debug runs.
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
 * Bench scripts may print logs around JSON; parse from the last valid JSON line to keep recording robust.
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
      // Ignore parse errors while searching for the JSON payload.
    }
  }

  throw new Error('Could not find JSON benchmark output.');
}

/**
 * Runs one suite in JSON mode so we can persist benchmark numbers as a baseline.
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
 * Ensures destination directory exists before writing the baseline file.
 * @param {string} filePath
 */
function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const outArg = readArgValue('--out');
  const outPath = outArg ? path.resolve(ROOT, outArg) : DEFAULT_BASELINE_PATH;

  const suites = SUITES.map(runSuite);
  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    suites,
  };

  ensureParentDirectory(outPath);
  fs.writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

  const relativePath = path.relative(ROOT, outPath);
  console.log('Recorded predicate performance baseline.');
  console.log(`Baseline file: ${relativePath}`);
  console.log('Use `npm run bench:check` to compare current results against this baseline.');
}

main();
