'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BENCH_DIR = __dirname;

/**
 * @param {string} label
 * @param {string} script
 */
function run(label, script) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [path.join(BENCH_DIR, script)], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${script} failed with status ${result.status}`);
  }
}

function main() {
  run('Predicate Runtime', 'bench-predicate-runtime.js');
  run('Room View', 'bench-room-view.js');
  run('Scenario Runner', 'bench-scenario.js');
}

main();
