import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { runSelfTest } from '../src/selftest.js';

test('in-browser self-test passes with a real RNG', () => {
  const failed = runSelfTest(randomBytes).filter((r) => !r.ok);
  assert.deepEqual(failed, []);
});

test('self-test flags a broken RNG', () => {
  for (const bad of [() => new Uint8Array(32), () => { throw new Error('no crypto'); }, () => new Uint8Array(4)]) {
    const rng = runSelfTest(bad).find((r) => r.name === 'Random number generator');
    assert.equal(rng.ok, false);
  }
});
