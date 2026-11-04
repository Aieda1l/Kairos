import {afterEach, beforeEach, expect, it} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {maintainAbuseState} from '../../scripts/lib/abuse-maintenance.mjs';
import {runGuestRetentionValidation} from '../../scripts/lib/guest-retention-probe.mjs';

let database: ReturnType<typeof openD1TestDatabase>;
beforeEach(() => { database = openD1TestDatabase(); });
afterEach(() => database.close());

const zero = {rateEvents: 0, runs: 0, oauthRequests: 0, bridgeRequests: 0};
type Maintain = typeof maintainAbuseState;

async function run(maintain: Maintain = maintainAbuseState, outboundAttempts = 0) {
  const receipts: unknown[] = [];
  const diagnostics: string[] = [];
  let disposed = false;
  const exitCode = await runGuestRetentionValidation({
    open: async () => ({db: database.db, dispose: async () => { disposed = true; },
      outboundAttempts: async () => outboundAttempts}),
    maintain,
    writeReceipt: async (receipt: unknown) => {
      expect(disposed).toBe(true);
      receipts.push(receipt);
    },
    diagnostic: (message: string) => diagnostics.push(message),
  });
  return {exitCode, receipts, diagnostics, disposed};
}

it('drains the real helper in independently bounded batches and emits only count/hash evidence', async () => {
  const result = await run();
  expect(result).toMatchObject({exitCode: 0, diagnostics: [], disposed: true});
  expect(result.receipts).toHaveLength(1);
  expect(result.receipts[0]).toMatchObject({
    code: 'GUEST_RETENTION_VALIDATED', batchSize: 100, maximumDrainInvocations: 4,
    expiredAnonymousBefore: 205, expiredAnonymousAfter: 0,
    dryRun: {counts: {rateEvents: 100, runs: 1, oauthRequests: 1, bridgeRequests: 1}},
    applies: [
      {counts: {rateEvents: 100, runs: 1, oauthRequests: 1, bridgeRequests: 1}},
      {counts: {rateEvents: 100, runs: 0, oauthRequests: 0, bridgeRequests: 0}},
      {counts: {rateEvents: 6, runs: 0, oauthRequests: 0, bridgeRequests: 0}},
    ],
    finalApply: {counts: zero}, outboundAttempts: 0,
  });
  expect(JSON.stringify(result.receipts)).not.toMatch(/retention-(?:user|expired|recent|owner)|payload_json|key_hash|code_verifier_envelope/);
  expect(database.sqlite.prepare('SELECT count(*) AS n FROM abuse_rate_events WHERE user_id IS NULL').get()).toEqual({n: 3});
});

it.each([
  ['dry-run mutation', async (db, options) => {
    const counts = await maintainAbuseState(db, options);
    if (!options.apply) await db.prepare("UPDATE abuse_controls SET version=version+1 WHERE control_key='provider:ed'").run();
    return counts;
  }],
  ['wrong rate deletion despite correct reported counts', async (db, options) => {
    const counts = await maintainAbuseState(db, options);
    if (options.apply) await db.prepare("DELETE FROM abuse_rate_events WHERE event_id='retention-recent-anonymous-0'").run();
    return counts;
  }],
  ['protected account content mutation', async (db, options) => {
    const counts = await maintainAbuseState(db, options);
    if (options.apply) await db.prepare("UPDATE app_settings SET value='changed'").run();
    return counts;
  }],
  ['fabricated deletion count without actual deletion', async (_db, options) => options.apply ? {...zero, rateEvents: 100} : {rateEvents: 100, runs: 1, oauthRequests: 1, bridgeRequests: 1}],
  ['independent table bound exceeded', async (db, options) => ({...await maintainAbuseState(db, options), oauthRequests: 101})],
  ['no progress on finite backlog', async () => zero],
] satisfies [string, Maintain][])('rejects %s, disposes and never writes a success receipt', async (_name, maintain) => {
  expect(await run(maintain)).toEqual({exitCode: 1, receipts: [], diagnostics: ['GUEST_RETENTION_VALIDATION_FAILED'], disposed: true});
});

it('rejects outbound attempts before a receipt', async () => {
  expect(await run(maintainAbuseState, 1)).toEqual({exitCode: 1, receipts: [], diagnostics: ['GUEST_RETENTION_VALIDATION_FAILED'], disposed: true});
});

it('sanitizes adapter errors and disposes on failure', async () => {
  expect(await run(async () => { throw new Error('private provider error'); })).toEqual({
    exitCode: 1, receipts: [], diagnostics: ['GUEST_RETENTION_VALIDATION_FAILED'], disposed: true,
  });
});
