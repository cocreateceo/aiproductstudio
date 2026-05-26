import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_ACTIONS } from './actions.expected.mjs';
import { ROUTES } from '../index.mjs';

test('registry covers every expected action', () => {
  const have = new Set(Object.keys(ROUTES));
  const missing = EXPECTED_ACTIONS.filter(a => !have.has(a));
  assert.deepEqual(missing, [], `missing handlers: ${missing.join(', ')}`);
});

test('registry has no unexpected (orphan) actions', () => {
  const expected = new Set(EXPECTED_ACTIONS);
  const extra = Object.keys(ROUTES).filter(a => !expected.has(a));
  assert.deepEqual(extra, [], `unexpected handlers: ${extra.join(', ')}`);
});
