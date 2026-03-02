'use strict';

const path = require('path');
const { createPredicateRuntime } = require('../../lib/helpers/predicate-runtime');
const { createSuiteResult, printBenchTable } = require('./bench-utils');

const BUNDLES_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * @returns {{ area: *, room: *, world: *, actor: *, container: * }}
 */
function buildFixture() {
  const area = {
    bundle: 'bundle-rantamuta',
    name: 'test',
    metadata: {
      values: {
        benchmarkEnabled: true,
      },
    },
  };

  const chest = {
    entityReference: 'test:labChest',
    inventory: [
      { entityReference: 'test:labApple' },
    ],
  };

  const room = {
    entityReference: 'test:predicates',
    area,
    metadata: {
      values: {
        variantPrimary: true,
        variantSecondary: false,
      },
    },
    items: [
      chest,
      { entityReference: 'test:labApple' },
    ],
  };

  const world = {
    RoomManager: {
      getRoom: roomRef => roomRef === 'test:predicates' ? room : null,
    },
    AreaManager: {
      getAreaByReference: areaRef => areaRef === 'test' ? area : null,
      getArea: areaRef => areaRef === 'test' ? area : null,
    },
  };

  const actor = {
    ref: 'player:benchmark',
    name: 'benchmark',
    level: 1,
    role: 2,
    room,
    inventory: [{ entityReference: 'test:labApple' }],
    effects: ['focus'],
    quests: {
      active: ['test:predicateQuestActive'],
      completed: ['test:predicateQuestDone'],
    },
  };

  return { area, room, world, actor, container: chest };
}

/**
 * @param {string} predicateName
 * @param {number} warmupSamples
 * @param {number} measuredSamples
 * @param {number} batchSize
 * @returns {number[]}
 */
function runCase(predicateName, warmupSamples, measuredSamples, batchSize) {
  const runtime = createPredicateRuntime({ bundlesRootPath: BUNDLES_ROOT });
  const fixture = buildFixture();
  const context = {
    actor: fixture.actor,
    area: fixture.area,
    room: fixture.room,
    world: fixture.world,
    source: 'bench.predicate-runtime',
    currentContainer: fixture.container,
  };

  /** @type {number[]} */
  const samples = [];
  const totalSamples = warmupSamples + measuredSamples;
  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const started = process.hrtime.bigint();
    for (let i = 0; i < batchSize; i += 1) {
      runtime.evaluate(predicateName, context);
    }
    const ended = process.hrtime.bigint();

    if (sampleIndex < warmupSamples) {
      continue;
    }

    const durationNs = Number(ended - started);
    samples.push(durationNs / batchSize);
  }

  return samples;
}

function main() {
  const emitJson = process.argv.includes('--json');
  const warmupSamples = 25;
  const measuredSamples = 150;
  const batchSize = 2000;

  const predicateCases = [
    'bench_always_true',
    'bench_always_false',
    'bench_room_flag_primary',
    'bench_area_flag_enabled',
    'bench_room_has_apple',
    'bench_room_container_has_apple',
    'bench_actor_has_apple',
    'bench_actor_has_focus',
    'bench_actor_quest_active',
    'bench_actor_quest_completed',
    'bench_composite_small',
    'bench_composite_large',
    'bench_invalid_return',
    'bench_throws',
    'bench_missing_predicate',
  ];

  const benches = predicateCases.map(name => ({
    name,
    samples: runCase(name, warmupSamples, measuredSamples, batchSize),
  }));

  const result = createSuiteResult('predicate-runtime', benches, {
    warmupSamples,
    measuredSamples,
    batchSize,
  });

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  console.log('Predicate Runtime Benchmark');
  console.log(`samples=${measuredSamples} warmup=${warmupSamples} batch=${batchSize}`);
  printBenchTable(benches);
}

main();
