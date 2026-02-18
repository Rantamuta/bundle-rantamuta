'use strict';

/**
 * @param {number[]} values
 * @param {number} percentile
 * @returns {number}
 */
function quantile(values, percentile) {
  if (!values.length) {
    return 0;
  }

  if (values.length === 1) {
    return values[0];
  }

  const clamped = Math.min(1, Math.max(0, percentile));
  const index = (values.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return values[lower];
  }

  const weight = index - lower;
  return values[lower] + ((values[upper] - values[lower]) * weight);
}

/**
 * @param {number[]} samplesNsPerOp
 * @returns {{ p50: number, p95: number, p99: number, mean: number }}
 */
function summarize(samplesNsPerOp) {
  if (!samplesNsPerOp.length) {
    return { p50: 0, p95: 0, p99: 0, mean: 0 };
  }

  const sorted = [...samplesNsPerOp].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);

  return {
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    mean: sum / sorted.length,
  };
}

/**
 * Produces raw stats per benchmark case so callers can render tables, emit JSON, or compare baselines.
 * @param {Array<{ name: string, samples: number[] }>} benches
 * @returns {Array<{ name: string, stats: { p50: number, p95: number, p99: number, mean: number }, opsPerSecond: number }>}
 */
function buildBenchStats(benches) {
  return benches.map(entry => {
    const stats = summarize(entry.samples);
    const opsPerSecond = stats.mean > 0 ? Math.floor(1e9 / stats.mean) : 0;
    return {
      name: entry.name,
      stats,
      opsPerSecond,
    };
  });
}

/**
 * @param {number} ns
 * @returns {string}
 */
function formatNs(ns) {
  if (ns >= 1e6) {
    return `${(ns / 1e6).toFixed(3)} ms`;
  }

  if (ns >= 1e3) {
    return `${(ns / 1e3).toFixed(3)} us`;
  }

  return `${ns.toFixed(1)} ns`;
}

/**
 * Creates a machine-readable suite payload for baseline recording and comparison.
 * @param {string} suiteName
 * @param {Array<{ name: string, samples: number[] }>} benches
 * @param {Record<string, *>} [metadata]
 * @returns {{
 *   suite: string,
 *   unit: string,
 *   generatedAt: string,
 *   metadata: Record<string, *>,
 *   cases: Array<{ name: string, stats: { p50: number, p95: number, p99: number, mean: number }, opsPerSecond: number }>
 * }}
 */
function createSuiteResult(suiteName, benches, metadata = {}) {
  return {
    suite: suiteName,
    unit: 'ns/op',
    generatedAt: new Date().toISOString(),
    metadata,
    cases: buildBenchStats(benches),
  };
}

/**
 * @param {Array<{ name: string, samples: number[] }>} benches
 */
function printBenchTable(benches) {
  const rows = buildBenchStats(benches).map(entry => ({
    name: entry.name,
    p50: formatNs(entry.stats.p50),
    p95: formatNs(entry.stats.p95),
    p99: formatNs(entry.stats.p99),
    mean: formatNs(entry.stats.mean),
    ops: `${entry.opsPerSecond.toLocaleString('en-US')} ops/s`,
  }));

  const header = ['Case', 'p50', 'p95', 'p99', 'mean', 'throughput'];
  const widths = [
    Math.max(header[0].length, ...rows.map(row => row.name.length)),
    Math.max(header[1].length, ...rows.map(row => row.p50.length)),
    Math.max(header[2].length, ...rows.map(row => row.p95.length)),
    Math.max(header[3].length, ...rows.map(row => row.p99.length)),
    Math.max(header[4].length, ...rows.map(row => row.mean.length)),
    Math.max(header[5].length, ...rows.map(row => row.ops.length)),
  ];

  const pad = (value, width) => `${value}${' '.repeat(Math.max(0, width - value.length))}`;
  const formatRow = values => values.map((value, index) => pad(value, widths[index])).join('  ');

  console.log(formatRow(header));
  console.log(formatRow(widths.map(width => '-'.repeat(width))));
  for (const row of rows) {
    console.log(formatRow([row.name, row.p50, row.p95, row.p99, row.mean, row.ops]));
  }
}

module.exports = {
  buildBenchStats,
  createSuiteResult,
  formatNs,
  printBenchTable,
  summarize,
};
