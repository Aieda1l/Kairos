import { expect, it, vi } from 'vitest';
import { openD1TestDatabase } from '../helpers/d1-test-db';
import { runMaintenanceCronWatchdog, watchdogStateSchema } from '../../scripts/lib/maintenance-cron-watchdog.mjs';

const timestamp = Date.parse('2026-11-24T21:00:00Z');
const outcome = {
  code: 'CRON_FAILED', dueTicks: 3, failedTicks: 1, missingTicks: 1,
  fromUtc: '2026-11-24T20:45:00.000Z', throughUtc: '2026-11-24T20:47:00.000Z',
} as const;
const healthy = { ...outcome, code: 'CRON_OK', failedTicks: 0, missingTicks: 0 } as const;

async function openWatchdog() {
  const fixture = openD1TestDatabase({ migrate: false });
  await fixture.db.exec(watchdogStateSchema);
  return fixture;
}

it('reports failed and missing invocations in one alert and suppresses repeats', async () => {
  const { db, close } = await openWatchdog();
  try {
    const sendAlert = vi.fn(async () => {});
    const run = (observedAtMs: number) => runMaintenanceCronWatchdog({ db, observedAtMs, observation: outcome, sendAlert });
    expect(await run(timestamp)).toEqual({ code: 'CRON_FAILED', dispatch: 'accepted' });
    expect(await run(timestamp)).toEqual({ code: 'CRON_FAILED', dispatch: 'suppressed' });
    expect(await run(timestamp + 60_000)).toEqual({ code: 'CRON_FAILED', dispatch: 'suppressed' });
    expect(sendAlert).toHaveBeenCalledExactlyOnceWith({
      failedTicks: 1, missingTicks: 1, fromUtc: outcome.fromUtc, throughUtc: outcome.throughUtc,
    });
  } finally { close(); }
});

it('ignores stale recovery and permits a fresh alert after a settled healthy observation', async () => {
  const { db, close } = await openWatchdog();
  const sendAlert = vi.fn(async () => {});
  try {
    await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp, observation: outcome, sendAlert });
    await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp - 60_000, observation: healthy, sendAlert });
    await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp + 60_000, observation: outcome, sendAlert });
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp + 120_000, observation: healthy, sendAlert }))
      .toEqual({ code: 'CRON_OK', dispatch: 'none' });
    const missing = { ...outcome, code: 'CRON_OVERDUE', failedTicks: 0 } as const;
    expect(await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp + 180_000, observation: missing, sendAlert }))
      .toEqual({ code: 'CRON_OVERDUE', dispatch: 'accepted' });
    expect(sendAlert).toHaveBeenCalledTimes(2);
  } finally { close(); }
});

it('claims before sending so concurrent checks cannot duplicate an alert', async () => {
  const { db, close } = await openWatchdog();
  let finishSend!: () => void;
  let startedSend!: () => void;
  const sentStarted = new Promise<void>(resolve => { startedSend = resolve; });
  const sendAlert = vi.fn(() => new Promise<void>(resolve => { finishSend = resolve; startedSend(); }));
  try {
    const pending = runMaintenanceCronWatchdog({ db, observedAtMs: timestamp, observation: outcome, sendAlert });
    await sentStarted;
    expect((await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp + 1, observation: outcome, sendAlert })).dispatch)
      .toBe('suppressed');
    finishSend();
    expect((await pending).dispatch).toBe('accepted');
    expect(sendAlert).toHaveBeenCalledTimes(1);
  } finally { close(); }
});

it('records uncertain delivery and does not retry or expose the provider message', async () => {
  const { db, sqlite, close } = await openWatchdog();
  const sendAlert = vi.fn(async () => { throw new Error('fixture private recipient and provider response'); });
  try {
    const first = await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp, observation: outcome, sendAlert });
    expect(first).toEqual({ code: 'CRON_FAILED', dispatch: 'unconfirmed' });
    expect(sqlite.prepare('SELECT mail_state FROM cron_watchdog_state').get()).toEqual({ mail_state: 'unconfirmed' });
    const next = await runMaintenanceCronWatchdog({ db, observedAtMs: timestamp + 1, observation: outcome, sendAlert });
    expect(next.dispatch).toBe('suppressed');
    expect(sendAlert).toHaveBeenCalledTimes(1);
  } finally { close(); }
});

it('distinguishes unavailable analytics from missing invocations and leaves alert state alone', async () => {
  const { db, sqlite, close } = await openWatchdog();
  const sendAlert = vi.fn(async () => {});
  try {
    expect(await runMaintenanceCronWatchdog({
      db, observedAtMs: timestamp, observation: { code: 'CRON_METRICS_UNAVAILABLE' }, sendAlert,
    })).toEqual({ code: 'CRON_METRICS_UNAVAILABLE', dispatch: 'none' });
    expect(sqlite.prepare('SELECT * FROM cron_watchdog_state').all()).toEqual([]);
    expect(sendAlert).not.toHaveBeenCalled();
  } finally { close(); }
});
