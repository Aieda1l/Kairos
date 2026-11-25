import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openD1TestDatabase } from '../helpers/d1-test-db';
import { cleanupControlSchema, cleanupCron, runMaintenanceCronCleanup } from '../../scripts/lib/maintenance-cron-cleanup.mjs';

const tickMs = Date.parse('2026-11-25T10:17:00Z');
const hour = 60 * 60_000;
const counts = { rateEvents: 100, runs: 1, oauthRequests: 0, bridgeRequests: 0 };
let app: ReturnType<typeof openD1TestDatabase>;
let operations: ReturnType<typeof openD1TestDatabase>;

beforeEach(() => {
  app = openD1TestDatabase();
  operations = openD1TestDatabase({ migrate: false });
  operations.sqlite.exec(cleanupControlSchema);
});

afterEach(() => {
  app.close();
  operations.close();
});

function invoke(mode?: string, scheduledTime = tickMs, nowMs = scheduledTime, cron: string = cleanupCron) {
  return runMaintenanceCronCleanup({
    controller: { cron, scheduledTime },
    env: { DB: app.db, OPERATIONS: operations.db, KAIROS_CRON_CLEANUP_MODE: mode },
    nowMs,
  });
}

function arm(from = tickMs) {
  operations.sqlite.prepare('UPDATE cron_cleanup_control SET apply_enabled=1, apply_from_ms=? WHERE id=1').run(from);
}

function seed() {
  app.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-a'), ('synthetic-b')");
  const event = app.sqlite.prepare('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)');
  for (let i = 0; i < 101; i++) event.run(String(i), 'A'.repeat(43), 'synthetic-b', 0, i);
  app.sqlite.exec(`
    INSERT INTO sync_all_runs VALUES ('synthetic-a','held',1,'[]'), ('synthetic-b','expired',1,'[]');
    INSERT INTO operation_locks VALUES ('synthetic-a','source:canvas','synthetic-owner','running',0,0,123);
  `);
}

it('rejects invalid modes and triggers before reaching either database', async () => {
  const appPrepare = vi.spyOn(app.db, 'prepare');
  const operationsPrepare = vi.spyOn(operations.db, 'prepare');
  await expect(invoke()).resolves.toEqual({ status: 'off' });
  await expect(invoke('on')).resolves.toEqual({ status: 'off' });
  await expect(invoke('apply', tickMs, tickMs, '* * * * *')).resolves.toEqual({ status: 'invalid-trigger' });
  await expect(invoke('apply', tickMs - 60_000)).resolves.toEqual({ status: 'invalid-trigger' });
  await expect(invoke('apply', tickMs + 16_000, tickMs)).resolves.toEqual({ status: 'invalid-trigger' });
  await expect(invoke('apply', tickMs, tickMs + 300_001)).resolves.toEqual({ status: 'invalid-trigger' });
  expect(appPrepare).not.toHaveBeenCalled();
  expect(operationsPrepare).not.toHaveBeenCalled();
});

it('normalizes second offsets and dry runs only bounded app SELECT statements', async () => {
  seed();
  const appPrepare = vi.spyOn(app.db, 'prepare');
  const operationsPrepare = vi.spyOn(operations.db, 'prepare');
  await expect(invoke('dry-run', tickMs + 8_000)).resolves.toEqual({ status: 'dry-run', tickMs, counts });
  expect(appPrepare.mock.calls).toHaveLength(4);
  expect(appPrepare.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(true);
  expect(operationsPrepare).not.toHaveBeenCalled();
  expect(app.sqlite.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').get()).toEqual({ n: 101 });
});

it('requires a durable enabled gate and eligible tick before touching the app database', async () => {
  const appPrepare = vi.spyOn(app.db, 'prepare');
  await expect(invoke('apply')).resolves.toEqual({ status: 'not-admitted' });
  arm(tickMs + 1);
  await expect(invoke('apply', tickMs + 5_000)).resolves.toEqual({ status: 'not-admitted' });
  expect(appPrepare).not.toHaveBeenCalled();
});

it('claims a tick once, protects active owners, and stores the sanitized count receipt', async () => {
  arm();
  seed();
  const receipts = await Promise.all([invoke('apply'), invoke('apply', tickMs + 9_000)]);
  expect(receipts).toContainEqual({ status: 'applied', tickMs, counts });
  expect(receipts).toContainEqual({ status: 'not-admitted' });
  expect(app.sqlite.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').get()).toEqual({ n: 1 });
  expect(app.sqlite.prepare('SELECT run_id FROM sync_all_runs').all()).toEqual([{ run_id: 'held' }]);
  expect(operations.sqlite.prepare('SELECT last_tick_ms, state, counts_json FROM cron_cleanup_control').get())
    .toEqual({ last_tick_ms: tickMs, state: 'success', counts_json: JSON.stringify(counts) });
  await expect(invoke('apply', tickMs - hour)).resolves.toEqual({ status: 'not-admitted' });
});

it('allows a claimed sweep to settle after gate closure and rejects a delayed trigger', async () => {
  arm();
  seed();
  const prepare = app.db.prepare.bind(app.db);
  vi.spyOn(app.db, 'prepare').mockImplementation((sql) => {
    operations.sqlite.exec('UPDATE cron_cleanup_control SET apply_enabled=0 WHERE id=1');
    return prepare(sql);
  });
  await expect(invoke('apply')).resolves.toEqual({ status: 'applied', tickMs, counts });
  expect(operations.sqlite.prepare('SELECT apply_enabled, state FROM cron_cleanup_control').get())
    .toEqual({ apply_enabled: 0, state: 'success' });
  await expect(invoke('apply', tickMs, tickMs + hour)).resolves.toEqual({ status: 'invalid-trigger' });
  await expect(invoke('apply', tickMs + hour)).resolves.toEqual({ status: 'not-admitted' });
});

it('keeps ambiguous apply operations blocked across future ticks and sanitizes errors', async () => {
  arm();
  const prepare = vi.spyOn(app.db, 'prepare').mockImplementation(() => { throw new Error('private DB error'); });
  await expect(invoke('apply')).rejects.toThrow(/^CRON_CLEANUP_FAILED$/);
  expect(operations.sqlite.prepare('SELECT last_tick_ms, state, counts_json FROM cron_cleanup_control').get())
    .toEqual({ last_tick_ms: tickMs, state: 'running', counts_json: null });
  prepare.mockClear();
  await expect(invoke('apply', tickMs + 2 * hour)).resolves.toEqual({ status: 'not-admitted' });
  expect(prepare).not.toHaveBeenCalled();
});
