'use strict';

/** Find the registered account owning a session token.
 * Socket.IO clients must not be allowed to create a player merely by inventing a token.
 */
function findAccountByToken(accounts, token) {
  if (typeof token !== 'string' || !token) return null;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
  for (const key of Object.keys(accounts)) {
    const account = accounts[key];
    if (account && typeof account.token === 'string' && account.token === token) return account;
  }
  return null;
}

/** Use a null-prototype dictionary for usernames so names such as "__proto__"
 * are handled as ordinary usernames rather than special object properties.
 */
function normalizeAccounts(source) {
  const result = Object.create(null);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  for (const key of Object.keys(source)) result[key] = source[key];
  return result;
}

module.exports = { findAccountByToken, normalizeAccounts };
