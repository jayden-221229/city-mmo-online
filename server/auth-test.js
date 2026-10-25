// node server/auth-test.js — no external packages required
'use strict';
const assert = require('assert');
const { findAccountByToken, normalizeAccounts } = require('./auth');

const accounts = normalizeAccounts({
  alice: { username: 'Alice', token: 'a'.repeat(64) },
  bob: { username: 'Bob', token: 'b'.repeat(64) },
});
assert.strictEqual(findAccountByToken(accounts, 'a'.repeat(64)).username, 'Alice');
assert.strictEqual(findAccountByToken(accounts, 'not-a-real-token'), null, 'unknown session tokens must be rejected');
assert.strictEqual(findAccountByToken(accounts, null), null, 'missing tokens must be rejected');
assert.strictEqual(findAccountByToken(null, 'a'.repeat(64)), null, 'missing account table must be rejected');

const special = normalizeAccounts(JSON.parse('{"__proto__":{"username":"Safe","token":"safe-token"},"constructor":{"username":"Constructor","token":"constructor-token"} }'));
assert.strictEqual(Object.getPrototypeOf(special), null, 'account map must have no prototype');
assert.strictEqual(findAccountByToken(special, 'safe-token').username, 'Safe');
assert.strictEqual(findAccountByToken(special, 'constructor-token').username, 'Constructor');
assert.strictEqual(Object.prototype.hasOwnProperty.call(special, '__proto__'), true);
console.log('auth tests passed');
