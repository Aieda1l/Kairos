// Disposable synthetic validation only; never import the remote maintenance CLI.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {maintainAbuseState} from './abuse-maintenance.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha256(JSON.stringify(value));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const canonical = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const batchSize = 100;
const maximumDrainInvocations = 4;
const names = ['rateEvents', 'runs', 'oauthRequests', 'bridgeRequests'];
const emptyCounts = () => Object.fromEntries(names.map(name => [name, 0]));

async function snapshot(db) {
  // D1 reserves these internals; all application tables (including controls) are checked.
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY name").all();
  assert.equal(tables.success, true);
  return Object.fromEntries(await Promise.all(tables.results.map(async ({name}) => {
    const result = await db.prepare(`SELECT * FROM ${quote(name)}`).all();
    assert.equal(result.success, true);
    return [name, canonical(result.results)];
  })));
}

function proof(before, expected, after) {
  assert.deepEqual(after, expected);
  return Object.fromEntries(Object.keys(expected).map(table => [table, {
    beforeRows: before[table].length, afterRows: after[table].length,
    beforeSha256: digest(before[table]), expectedSha256: digest(expected[table]), afterSha256: digest(after[table]),
  }]));
}

function checkCounts(counts, expected) {
  assert.deepEqual(Object.keys(counts).sort(), names.slice().sort());
  for (const name of names) {
    assert(Number.isSafeInteger(counts[name]) && counts[name] >= 0 && counts[name] <= batchSize);
  }
  assert.deepEqual(counts, expected);
}

async function seed(db) {
  const clock = await db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 AS now_ms").first();
  assert(Number.isSafeInteger(clock?.now_ms));
  const now = clock.now_ms;
  const old = now - 86_400_000;
  const future = now + 86_400_000;
  const oldIso = new Date(old).toISOString();
  const futureIso = new Date(future).toISOString();
  const insert = async (sql, ...values) => {
    const result = await db.prepare(sql).bind(...values).run();
    assert.equal(result.success, true);
  };
  for (const id of ['retention-user-idle', 'retention-user-running', 'retention-user-uncertain']) {
    await insert('INSERT INTO users(id) VALUES (?)', id);
  }
  for (const state of ['idle', 'running', 'uncertain']) {
    await insert('INSERT INTO operation_locks VALUES (?,?,?,?,?,?,?)', `retention-user-${state}`, 'source:canvas', 'retention-owner', state, old, old, 0);
  }
  const rates = [];
  for (let i = 0; i < 205; i++) {
    const id = 'retention-expired-anonymous-' + String(i).padStart(3, '0');
    rates.push(id);
    await insert('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)', id, 'A'.repeat(43), null, old - 3_600_000 + i, old + i);
  }
  // The actual helper also expires account-associated rates. This row is explicitly eligible.
  rates.push('retention-expired-account');
  await insert('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)', rates.at(-1), 'B'.repeat(43), 'retention-user-idle', old - 3_600_000 + 205, old + 205);
  for (let i = 0; i < 3; i++) {
    await insert('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)', `retention-recent-anonymous-${i}`, 'C'.repeat(43), null, now, future);
  }
  for (let i = 0; i < 2; i++) {
    await insert('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)', `retention-recent-account-${i}`, 'D'.repeat(43), 'retention-user-idle', now, future);
  }
  // Protected content uses inert settings, never coursework, credentials or capabilities.
  await insert('INSERT INTO app_settings VALUES (?,?,?,?)', 'retention-user-idle', 'retention-sentinel', 'synthetic-setting', oldIso);
  for (const state of ['idle', 'running', 'uncertain']) {
    const user = `retention-user-${state}`;
    await insert('INSERT INTO sync_all_runs VALUES (?,?,?,?)', user, 'retention-expired-run', old, '[]');
    await insert('INSERT INTO sync_all_steps VALUES (?,?,?,?)', user, 'retention-expired-run', 'ed', old);
    await insert('INSERT INTO oauth_requests(user_id,state_hash,provider,code_verifier_envelope,return_to,redirect_uri,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
      user, 'retention-expired-oauth', 'google', 'inert-not-a-credential', '/', 'https://synthetic.invalid', oldIso, oldIso);
    await insert('INSERT INTO sync_requests(user_id,request_id,kind,payload_json,created_at,expires_at,consumed_at,operation_key,owner_nonce) VALUES (?,?,?,?,?,?,?,?,?)',
      user, 'retention-expired-bridge', 'canvas_submission', '{}', oldIso, oldIso, oldIso, 'source:canvas', 'retention-owner');
  }
  await insert('INSERT INTO sync_all_runs VALUES (?,?,?,?)', 'retention-user-idle', 'retention-recent-run', future, '[]');
  await insert('INSERT INTO oauth_requests(user_id,state_hash,provider,code_verifier_envelope,return_to,redirect_uri,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
    'retention-user-idle', 'retention-recent-oauth', 'google', 'inert-not-a-credential', '/', 'https://synthetic.invalid', oldIso, futureIso);
  for (const [id, expires, consumed, owner] of [
    ['retention-recent-bridge', futureIso, oldIso, 'retention-owner'],
    ['retention-unconsumed-bridge', oldIso, null, 'retention-owner'],
    ['retention-mismatched-bridge', oldIso, oldIso, 'different-inert-owner'],
    ['retention-legacy-bridge', oldIso, oldIso, null],
  ]) {
    await insert('INSERT INTO sync_requests(user_id,request_id,kind,payload_json,created_at,expires_at,consumed_at,operation_key,owner_nonce) VALUES (?,?,?,?,?,?,?,?,?)',
      'retention-user-idle', id, 'canvas_submission', '{}', oldIso, expires, consumed, 'source:canvas', owner);
  }
  return {now, future, rates};
}

async function validate(db, maintain) {
  const fixture = await seed(db);
  let before = await snapshot(db);
  const initial = before;
  const expectedDry = {rateEvents: 100, runs: 1, oauthRequests: 1, bridgeRequests: 1};
  const startedDry = performance.now();
  const dryCounts = await maintain(db, {batchSize, apply: false});
  checkCounts(dryCounts, expectedDry);
  const dryRun = {counts: dryCounts, elapsedMs: performance.now() - startedDry,
    snapshots: proof(before, before, await snapshot(db))};
  const applies = [];
  let remaining = fixture.rates.slice();
  for (let invocation = 0; remaining.length && invocation < maximumDrainInvocations; invocation++) {
    const deleting = new Set(remaining.slice(0, batchSize));
    const expected = structuredClone(before);
    expected.abuse_rate_events = expected.abuse_rate_events.filter(row => !deleting.has(row.event_id));
    if (invocation === 0) {
      for (const [table, id, value] of [
        ['sync_all_runs', 'run_id', 'retention-expired-run'],
        ['sync_all_steps', 'run_id', 'retention-expired-run'],
        ['oauth_requests', 'state_hash', 'retention-expired-oauth'],
        ['sync_requests', 'request_id', 'retention-expired-bridge'],
      ]) expected[table] = expected[table].filter(row => !(row.user_id === 'retention-user-idle' && row[id] === value));
    }
    const expectedCounts = {rateEvents: deleting.size, runs: invocation === 0 ? 1 : 0,
      oauthRequests: invocation === 0 ? 1 : 0, bridgeRequests: invocation === 0 ? 1 : 0};
    const started = performance.now();
    const counts = await maintain(db, {batchSize, apply: true});
    checkCounts(counts, expectedCounts);
    const after = await snapshot(db);
    applies.push({counts, elapsedMs: performance.now() - started, snapshots: proof(before, expected, after)});
    remaining = remaining.slice(batchSize);
    before = after;
  }
  assert.equal(remaining.length, 0);
  // Actual DB absence, independent of helper counts or the expected-state model.
  const absent = await db.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events WHERE purge_after_ms<=?').bind(fixture.now).first();
  const anonymous = await db.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events WHERE user_id IS NULL AND purge_after_ms<=?').bind(fixture.now).first();
  assert.equal(absent?.n, 0);
  assert.equal(anonymous?.n, 0);
  const startedFinal = performance.now();
  const finalCounts = await maintain(db, {batchSize, apply: true});
  checkCounts(finalCounts, emptyCounts());
  const final = await snapshot(db);
  const finalApply = {counts: finalCounts, elapsedMs: performance.now() - startedFinal, snapshots: proof(before, before, final)};
  const end = await db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 AS now_ms").first();
  assert(end.now_ms >= fixture.now && end.now_ms < fixture.future);
  return {code: 'GUEST_RETENTION_VALIDATED', batchSize, maximumDrainInvocations,
    expiredAnonymousBefore: 205, expiredAnonymousAfter: anonymous.n, expiredRateRowsAfter: absent.n,
    dryRun, applies, finalApply, snapshots: proof(initial, final, final)};
}

export async function runGuestRetentionValidation({open, writeReceipt, diagnostic, maintain = maintainAbuseState}) {
  let instance;
  try {
    instance = await open();
    let receipt;
    try {
      receipt = await validate(instance.db, maintain);
      const outboundAttempts = await instance.outboundAttempts();
      assert.equal(outboundAttempts, 0);
      receipt.outboundAttempts = outboundAttempts;
    } finally {
      await instance.dispose();
      instance = undefined;
    }
    await writeReceipt(receipt);
    return 0;
  } catch {
    diagnostic('GUEST_RETENTION_VALIDATION_FAILED');
    return 1;
  }
}
