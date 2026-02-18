'use strict';

const path = require('path');
const { buildRoomViewLines } = require('../../lib/helpers/room-view-helper');
const { createPredicateRuntime } = require('../../lib/helpers/predicate-runtime');
const { createSuiteResult, printBenchTable } = require('./bench-utils');

const BUNDLES_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * @param {number} count
 * @param {(index: number) => string} predicateForIndex
 * @param {string} textPrefix
 * @returns {Array<{ when: string, text: string }>}
 */
function buildWhenEntries(count, predicateForIndex, textPrefix) {
  return Array.from({ length: count }, (_value, index) => ({
    when: predicateForIndex(index),
    text: `${textPrefix} ${index + 1}.`,
  }));
}

/**
 * @param {{ variants?: Array<{ when: string, text: string }>, fragments?: Array<{ when: string, text: string }>, includeItems?: boolean }} scenario
 * @returns {{ room: *, area: *, world: *, actor: * }}
 */
function buildFixture(scenario) {
  const runtime = createPredicateRuntime({ bundlesRootPath: BUNDLES_ROOT });
  const area = {
    bundle: 'bundle-rantamuta',
    name: 'test',
    metadata: {
      flags: {
        benchmarkEnabled: true,
      },
    },
  };

  const room = {
    entityReference: 'test:predicates',
    title: 'Predicate Test Room',
    description: 'A deterministic benchmark room for predicate render measurements.',
    area,
    metadata: {
      flags: {
        variantPrimary: true,
        variantSecondary: false,
      },
      descriptionVariants: Array.isArray(scenario.variants) ? scenario.variants : [],
      descriptionFragments: Array.isArray(scenario.fragments) ? scenario.fragments : [],
    },
    exits: [{ direction: 'south' }, { direction: 'west' }],
    items: scenario.includeItems
      ? new Set([
          { entityReference: 'test:labApple', roomDesc: 'A practice apple rests here.' },
          {
            entityReference: 'test:labChest',
            name: 'practice chest',
            inventory: [{ entityReference: 'test:labApple' }],
          },
        ])
      : new Set(),
  };

  const world = {
    PredicateRuntime: runtime,
    RoomManager: {
      getRoom: roomRef => roomRef === room.entityReference ? room : null,
    },
    AreaManager: {
      getAreaByReference: areaRef => areaRef === area.name ? area : null,
      getArea: areaRef => areaRef === area.name ? area : null,
    },
  };

  const actor = {
    ref: 'player:bench',
    name: 'bench',
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

  return { room, area, world, actor };
}

/**
 * @param {{ variants?: Array<{ when: string, text: string }>, fragments?: Array<{ when: string, text: string }>, includeItems?: boolean }} scenario
 * @param {number} warmupSamples
 * @param {number} measuredSamples
 * @param {number} batchSize
 * @returns {number[]}
 */
function runCase(scenario, warmupSamples, measuredSamples, batchSize) {
  const fixture = buildFixture(scenario);

  /** @type {number[]} */
  const samples = [];
  const totalSamples = warmupSamples + measuredSamples;
  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const started = process.hrtime.bigint();
    for (let i = 0; i < batchSize; i += 1) {
      buildRoomViewLines(fixture.room, {
        actor: fixture.actor,
        room: fixture.room,
        area: fixture.area,
        world: fixture.world,
      });
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
  const warmupSamples = 20;
  const measuredSamples = 120;
  const batchSize = 600;

  const cases = [
    {
      name: 'baseline_no_predicates',
      scenario: {},
    },
    {
      name: 'variants_1_true',
      scenario: {
        variants: buildWhenEntries(1, () => 'bench_always_true', 'Variant line'),
      },
    },
    {
      name: 'variants_5_first',
      scenario: {
        variants: buildWhenEntries(5, index => index === 0 ? 'bench_always_true' : 'bench_always_false', 'Variant line'),
      },
    },
    {
      name: 'variants_20_last',
      scenario: {
        variants: buildWhenEntries(20, index => index === 19 ? 'bench_always_true' : 'bench_always_false', 'Variant line'),
      },
    },
    {
      name: 'fragments_5_half',
      scenario: {
        fragments: buildWhenEntries(5, index => index % 2 === 0 ? 'bench_always_true' : 'bench_always_false', 'Fragment line'),
      },
    },
    {
      name: 'fragments_20_all',
      scenario: {
        fragments: buildWhenEntries(20, () => 'bench_always_true', 'Fragment line'),
      },
    },
    {
      name: 'mixed_20_20',
      scenario: {
        variants: buildWhenEntries(20, index => index === 19 ? 'bench_always_true' : 'bench_always_false', 'Variant line'),
        fragments: buildWhenEntries(20, () => 'bench_always_true', 'Fragment line'),
      },
    },
    {
      name: 'mixed_with_items',
      scenario: {
        variants: buildWhenEntries(5, index => index === 0 ? 'bench_room_flag_primary' : 'bench_always_false', 'Variant line'),
        fragments: [
          { when: 'bench_area_flag_enabled', text: 'Fragment area flag.' },
          { when: 'bench_room_has_apple', text: 'Fragment room item.' },
          { when: 'bench_room_container_has_apple', text: 'Fragment container item.' },
          { when: 'bench_actor_has_apple', text: 'Fragment actor item.' },
          { when: 'bench_actor_has_focus', text: 'Fragment actor effect.' },
        ],
        includeItems: true,
      },
    },
  ];

  const benches = cases.map(entry => ({
    name: entry.name,
    samples: runCase(entry.scenario, warmupSamples, measuredSamples, batchSize),
  }));

  const result = createSuiteResult('room-view', benches, {
    warmupSamples,
    measuredSamples,
    batchSize,
  });

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  console.log('Room View Benchmark');
  console.log(`samples=${measuredSamples} warmup=${warmupSamples} batch=${batchSize}`);
  printBenchTable(benches);
}

main();
