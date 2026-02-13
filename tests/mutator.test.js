'use strict';

const assert = require('assert');
const {
  applyMutationInstruction,
  applyMutationPlan,
} = require('../lib/session/mutator');

function createContainer(items = []) {
  const bag = [...items];
  return {
    bag,
    addItem(item) {
      bag.push(item);
    },
    removeItem(item) {
      const index = bag.indexOf(item);
      if (index < 0) {
        throw new Error('Item missing from container.');
      }
      bag.splice(index, 1);
    },
  };
}

describe('bundle-rantamuta mutator', function () {
  it('applies transferItem instruction and returns inverse operation', function () {
    const item = { id: 'test:sword' };
    const from = createContainer([item]);
    const to = createContainer();

    const undo = applyMutationInstruction({}, {
      type: 'transferItem',
      item,
      from,
      to,
    });

    assert.deepStrictEqual(from.bag, []);
    assert.deepStrictEqual(to.bag, [item]);

    undo();

    assert.deepStrictEqual(from.bag, [item]);
    assert.deepStrictEqual(to.bag, []);
  });

  it('throws for unsupported instruction types', function () {
    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({ type: 'unknown-op' }));
    }, /Unsupported mutation instruction type/);
  });

  it('rolls back prior operations when a later plan operation fails', function () {
    const item = { id: 'test:apple' };
    const from = createContainer([item]);
    const to = createContainer();

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          { type: 'transferItem', item, from, to },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(from.bag, [item]);
    assert.deepStrictEqual(to.bag, []);
  });

  it('accepts noop instructions in plans', function () {
    assert.doesNotThrow(() => {
      applyMutationPlan({}, {
        operations: [{ type: 'noop' }],
      });
    });
  });
});
