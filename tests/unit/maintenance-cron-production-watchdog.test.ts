import { afterEach, expect, it, vi } from 'vitest';
import { openD1TestDatabase } from '../helpers/d1-test-db';
import { cleanupControlSchema } from '../../scripts/lib/maintenance-cron-cleanup.mjs';
import { productionWatchdogSchema, runProductionCronWatchdog } from '../../scripts/lib/maintenance-cron-production-watchdog.mjs';

const hour = 3_600_000;
const poll = 15 * 60_000;
const activationMs = Date.parse('2026-11-25T09:17:00Z');
const failures = (tickMs: number) => ({ tickMs, status: 'failure' as const });
const missing = (tickMs: number) => ({ tickMs, status: 'missing' as const });
const healthy = (tickMs: number) => ({ tickMs, status: 'success' as const });
const owners: ReturnType<typeof openD1TestDatabase>[] = [];
afterEach(() => { while (owners.length) owners.pop()?.close(); });

async function fixture() {
  const fixture = openD1TestDatabase({ migrate: false });
  owners.push(fixture);
  await fixture.db.exec(cleanupControlSchema);
  await fixture.db.exec(productionWatchdogSchema);
  await fixture.db.prepare('UPDATE cron_cleanup_control SET apply_enabled=1,apply_from_ms=? WHERE id=1').bind(activationMs).run();
  const sendAlert = vi.fn<Parameters<typeof runProductionCronWatchdog>[0]['sendAlert']>(async () => {});
  const run = (observedAtMs: number, ticks: Parameters<typeof runProductionCronWatchdog>[0]['ticks'], completion: Parameters<typeof runProductionCronWatchdog>[0]['completion'] = null) =>
    runProductionCronWatchdog({ operations: fixture.db, activationMs, observedAtMs, ticks, completion, sendAlert });
  return { ...fixture, sendAlert, run };
}

it('requires two distinct observations of the same missing tick and emits one alert', async () => {
  const { run, sendAlert } = await fixture();
  const ticks = [missing(activationMs)];
  const first = activationMs + poll;
  expect(await run(first, ticks)).toEqual({code:'CRON_MISSING_PENDING',dispatch:'none'});
  expect((await run(first + 500, ticks)).dispatch).toBe('suppressed');
  expect((await run(first + poll, ticks)).dispatch).toBe('accepted');
  expect((await run(first + 2 * poll, ticks)).dispatch).toBe('suppressed');
  expect(sendAlert).toHaveBeenCalledExactlyOnceWith({
    failedTicks:0,missingTicks:1,fromUtc:'2026-11-25T09:17:00.000Z',throughUtc:'2026-11-25T09:17:00.000Z',
  });
});

it('reports a confirmed failure immediately and rearms on newer verified completion', async () => {
  const { run, sendAlert } = await fixture();
  const next = activationMs + hour;
  const last = next + hour;
  expect((await run(activationMs + poll, [failures(activationMs)])).dispatch).toBe('accepted');
  expect((await run(next + poll, [failures(activationMs),healthy(next)], {last_tick_ms:next,state:'success'})).code).toBe('CRON_OK');
  expect((await run(next+2*poll, [failures(activationMs),healthy(next)], {last_tick_ms:next,state:'success'})).dispatch).toBe('none');
  expect((await run(last+poll, [failures(activationMs),healthy(next),failures(last)], {last_tick_ms:next,state:'success'})).dispatch).toBe('accepted');
  expect(sendAlert).toHaveBeenCalledTimes(2);
  expect(sendAlert.mock.calls[1]?.[0]).toMatchObject({failedTicks:1,missingTicks:0,throughUtc:'2026-11-25T11:17:00.000Z'});
});

it('reports a previously unseen failure after a monitor gap even if cleanup recovered', async () => {
  const { run, sendAlert } = await fixture();
  const later = activationMs + hour;
  const ticks = [failures(activationMs), healthy(later)];
  const completion = {last_tick_ms:later,state:'success'} as const;
  expect(await run(later + poll, ticks, completion)).toEqual({code:'CRON_FAILED_RECOVERED',dispatch:'accepted'});
  expect(await run(later + 2*poll, ticks, completion)).toEqual({code:'CRON_OK',dispatch:'none'});
  expect(sendAlert).toHaveBeenCalledExactlyOnceWith({
    failedTicks:1,missingTicks:0,fromUtc:'2026-11-25T09:17:00.000Z',throughUtc:'2026-11-25T09:17:00.000Z',
    recovered:true,
  });
});

it('uses a successful invocation without a completed sweep as a possible missing cleanup', async () => {
  const { run, sendAlert } = await fixture();
  const ticks = [healthy(activationMs)];
  expect((await run(activationMs + poll, ticks, {last_tick_ms:0,state:'idle'})).code).toBe('CRON_MISSING_PENDING');
  expect((await run(activationMs + 2*poll, ticks, {last_tick_ms:activationMs,state:'running'})).code).toBe('CRON_OVERDUE');
  expect(sendAlert).toHaveBeenCalledTimes(1);
});

it('suppresses concurrent repeat sends and leaves an unconfirmed send recorded', async () => {
  const { run, sendAlert, sqlite } = await fixture();
  let reject!: (reason: unknown) => void;
  let requested!: () => void;
  const ready = new Promise<void>(resolve => { requested = resolve; });
  sendAlert.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => {reject=rejectPromise;requested();}));
  const first = run(activationMs + poll, [failures(activationMs)]);
  await ready;
  expect((await run(activationMs + 2*poll, [failures(activationMs)])).dispatch).toBe('suppressed');
  reject(new Error('private fixture upstream failure'));
  expect(await first).toEqual({code:'CRON_FAILED',dispatch:'unconfirmed'});
  expect((await run(activationMs + 3*poll, [failures(activationMs)])).dispatch).toBe('suppressed');
  expect(sqlite.prepare('SELECT mail_state FROM cron_watchdog_production_state').get()).toEqual({mail_state:'unconfirmed'});
  expect(sendAlert).toHaveBeenCalledTimes(1);
});

it('preserves the newer recovery if the old delivery finishes after its claim was closed', async () => {
  const { run, sendAlert, sqlite } = await fixture();
  let settle!: () => void;
  let requested!: () => void;
  const ready = new Promise<void>(resolve => { requested = resolve; });
  sendAlert.mockImplementationOnce(() => new Promise<void>(resolve => { settle=resolve;requested(); }));
  const first = run(activationMs + poll, [failures(activationMs)]);
  await ready;
  const later = activationMs + hour;
  const ticks = [failures(activationMs), healthy(later)];
  const completion = {last_tick_ms:later,state:'success'} as const;
  expect((await run(later + poll, ticks, completion)).code).toBe('CRON_OK');
  settle();
  expect((await first).dispatch).toBe('unconfirmed');
  expect(sqlite.prepare('SELECT incident_id FROM cron_watchdog_production_state').get()).toEqual({incident_id:null});
  expect((await run(later + 2*poll, ticks, completion)).code).toBe('CRON_OK');
  expect(sendAlert).toHaveBeenCalledTimes(1);
});

it('stops new mail claims on rollback even if the previously scheduled event still arrives', async () => {
  const { run, sendAlert, sqlite } = await fixture();
  sqlite.prepare('UPDATE cron_cleanup_control SET apply_enabled=0 WHERE id=1').run();
  expect(await run(activationMs + poll, [failures(activationMs)])).toEqual({code:'CRON_WATCHDOG_INACTIVE',dispatch:'none'});
  expect(sendAlert).not.toHaveBeenCalled();
});
