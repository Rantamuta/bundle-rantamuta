'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
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

  it('rejects transferItem when endpoints are not reversible', function () {
    const item = { id: 'test:coin' };
    const from = {
      removeItem: () => {},
    };
    const to = {
      addItem: () => {},
      removeItem: () => {},
    };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to,
      }));
    }, /transferItem\.from must provide addItem\(item\) and removeItem\(item\)\./);
  });

  it('restores source container if transferItem add fails', function () {
    const item = { id: 'test:ruby' };
    const from = createContainer([item]);
    const to = {
      addItem: () => {
        throw new Error('Destination full.');
      },
      removeItem: () => {},
    };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to,
      }));
    }, /Destination full\./);

    assert.deepStrictEqual(from.bag, [item]);
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

  it('logs error severity when rollback itself fails', function () {
    const item = { id: 'test:emerald' };
    const from = createContainer([item]);
    const to = {
      addItem() {},
      removeItem() {
        throw new Error('Rollback remove failed.');
      },
    };

    const originalLoggerError = ranvier.Logger.error;
    /** @type {string[]} */
    const errors = [];
    ranvier.Logger.error = (message) => {
      errors.push(String(message));
    };

    try {
      assert.throws(() => {
        applyMutationPlan({}, {
          operations: [
            { type: 'transferItem', item, from, to },
            /** @type {*} */ ({ type: 'unsupported' }),
          ],
        });
      }, /Unsupported mutation instruction type/);
    } finally {
      ranvier.Logger.error = originalLoggerError;
    }

    assert.ok(errors.some(message => message.includes('MUTATOR ROLLBACK FAILURE')));
    assert.ok(errors.some(message => message.includes('operation 0')));
  });

  it('accepts noop instructions in plans', function () {
    assert.doesNotThrow(() => {
      applyMutationPlan({}, {
        operations: [{ type: 'noop' }],
      });
    });
  });
});
