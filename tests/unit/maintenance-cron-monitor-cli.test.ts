import { expect, it, vi } from 'vitest';
import { checkMaintenanceCron } from '../../scripts/check-maintenance-cron.mjs';
import { observeHourlyMaintenanceCron, observeMaintenanceCron } from '../../scripts/lib/maintenance-cron-observation.mjs';

const nowMs = Date.parse('2026-11-24T09:45:00.000Z');
const env = {
  CLOUDFLARE_CRON_ANALYTICS_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_CRON_ANALYTICS_TOKEN: 'fixture.only.read-token',
  KAIROS_CRON_MONITOR_WORKER: 'kairos-cron-probe-20261124-fixture',
  KAIROS_CRON_MONITOR_FIRST_TICK_UTC: '2026-11-24T09:30:00Z',
  KAIROS_CRON_MONITOR_LAST_TICK_UTC: '2026-11-24T09:31:00Z',
  KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '1',
};
const watch = (rows: unknown[]) => Response.json({ data: { viewer: {
  accounts: [{ workersInvocationsAdaptive: rows }],
} } });
const sample = (datetimeMinute: string, status = 'success') => ({
  dimensions: { scriptName: env.KAIROS_CRON_MONITOR_WORKER, eventType: 'cron', status, datetimeMinute },
  sum: { requests: 1, errors: status === 'success' ? 0 : 1 },
});

it('queries only due slots and sends authorization only to the analytics endpoint', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => watch([
    sample('2026-11-24T09:30:00Z'), sample('2026-11-24T09:31:00Z'),
  ]));
  const result = await checkMaintenanceCron({ env, nowMs, fetchImpl });
  expect(result).toMatchObject({ code: 'CRON_OK', dueTicks: 2 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, request] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
  expect(request).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store' });
  expect(new Headers(request?.headers).get('authorization')).toBe('Bearer '+env.CLOUDFLARE_CRON_ANALYTICS_TOKEN);
  const body = JSON.parse(String(request?.body));
  expect(body.query).toContain('eventType: "cron"');
  expect(body.variables).toMatchObject({ scriptName: env.KAIROS_CRON_MONITOR_WORKER,
    from: '2026-11-24T09:30:00.000Z', until: '2026-11-24T09:32:00.000Z' });
});

it('does no analytics work for a window that has not settled', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  expect(await checkMaintenanceCron({ env, nowMs: nowMs - 10 * 60_000, fetchImpl })).toMatchObject({ code: 'CRON_NOT_DUE' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('distinguishes an observed failure from an overdue tick', async () => {
  const unhealthy = () => Promise.resolve(watch([sample('2026-11-24T09:31:00Z', 'scriptThrewException')]));
  expect(await checkMaintenanceCron({ env, nowMs, fetchImpl: unhealthy })).toMatchObject({ code: 'CRON_FAILED' });
  const missing = () => Promise.resolve(watch([sample('2026-11-24T09:31:00Z')]));
  expect(await checkMaintenanceCron({ env, nowMs, fetchImpl: missing })).toMatchObject({ code: 'CRON_OVERDUE' });
});

it('rejects analytics redirects before following them', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
    status: 307, headers: { location: 'https://wrong-host.invalid/' },
  }));
  expect(await checkMaintenanceCron({ env, nowMs, fetchImpl })).toMatchObject({ code: 'CRON_METRICS_UNAVAILABLE' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([403, 500])('returns a fixed result on analytics HTTP %i', async (status) => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('sensitive provider error', { status }));
  const result = await checkMaintenanceCron({ env, nowMs, fetchImpl });
  expect(result).toMatchObject({ code: 'CRON_METRICS_UNAVAILABLE' });
  expect(JSON.stringify(result)).not.toContain('sensitive provider error');
});

it('rejects unaligned configuration without contacting Cloudflare', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await checkMaintenanceCron({ env: { ...env, KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '2' }, nowMs, fetchImpl });
  expect(result).toEqual({ code: 'CRON_MONITOR_CONFIG_INVALID' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects intervals that cannot repeat uniformly within each hour', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await checkMaintenanceCron({ env: { ...env, KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '7',
    KAIROS_CRON_MONITOR_LAST_TICK_UTC: '' }, nowMs, fetchImpl });
  expect(result).toEqual({ code: 'CRON_MONITOR_CONFIG_INVALID' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('stops querying once a bounded verification window has expired', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await checkMaintenanceCron({ env, nowMs: nowMs + 12 * 60 * 60_000, fetchImpl });
  expect(result).toEqual({ code: 'CRON_WINDOW_EXPIRED' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('reports counts for failure and missing in the same settled window', async () => {
  const fetchImpl = async () => watch([sample('2026-11-24T09:31:00Z', 'scriptThrewException')]);
  const legacy = {
    code: 'CRON_FAILED',
    dueTicks: 2,
    fromUtc: '2026-11-24T09:30:00.000Z',
    throughUtc: '2026-11-24T09:31:00.000Z',
  };
  expect(await observeMaintenanceCron({ env, nowMs, fetchImpl })).toEqual({
    ...legacy, failedTicks: 1, missingTicks: 1,
  });
  expect(await checkMaintenanceCron({ env, nowMs, fetchImpl })).toEqual(legacy);
});

const hourlyEnv = {
  ...env,
  KAIROS_CRON_MONITOR_FIRST_TICK_UTC: '2026-11-23T21:17:00Z',
  KAIROS_CRON_MONITOR_LAST_TICK_UTC: '2026-11-24T10:17:00Z',
  KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '60',
};
const hourlyNow = Date.parse('2026-11-24T09:27:00Z');

it('observes the settled hourly ticks in a bounded query, including a five-minute late invocation', async () => {
  const fixture = [
    sample('2026-11-23T21:17:00Z'),
    sample('2026-11-23T22:18:00Z'),
    sample('2026-11-23T23:17:00Z', 'scriptThrewException'),
    sample('2026-11-24T09:22:00Z'),
    sample('2026-11-24T09:23:00Z'),
  ];
  const fetchImpl = vi.fn<typeof fetch>(async (_url, request) => {
    const { variables: { from, until } } = JSON.parse(String(request?.body));
    return watch(fixture.filter(({ dimensions }) => {
      const minute = Date.parse(dimensions.datetimeMinute);
      return minute >= Date.parse(from) && minute < Date.parse(until);
    }));
  });
  const result = await observeHourlyMaintenanceCron({ env: hourlyEnv, nowMs: hourlyNow, fetchImpl });
  const { variables } = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(variables).toMatchObject({
    from: '2026-11-23T22:17:00.000Z',
    until: '2026-11-24T09:23:00.000Z',
  });
  expect(result).toMatchObject({ code: 'CRON_FAILED', dueTicks: 12, failedTicks: 1, missingTicks: 9 });
  expect(result.ticks).toHaveLength(12);
  expect(result.ticks?.slice(0, 3)).toEqual([
    { tickMs: Date.parse('2026-11-23T22:17:00Z'), status: 'success' },
    { tickMs: Date.parse('2026-11-23T23:17:00Z'), status: 'failure' },
    { tickMs: Date.parse('2026-11-24T00:17:00Z'), status: 'missing' },
  ]);
  expect(result.ticks?.at(-1)).toEqual({
    tickMs: Date.parse('2026-11-24T09:17:00Z'), status: 'success',
  });
});

it.each([
  ['duplicate minute groups', [sample('2026-11-24T09:17:00Z'), sample('2026-11-24T09:17:00Z')]],
  ['conflicting groups across minutes', [sample('2026-11-24T09:17:00Z'), sample('2026-11-24T09:20:00Z', 'scriptThrewException')]],
  ['a group outside a tick window', [sample('2026-11-24T08:23:00Z')]],
  ['a non-minute timestamp', [sample('2026-11-24T09:17:01Z')]],
])('reports unavailable for %s', async (_description, rows) => {
  const fetchImpl = async () => watch(rows);
  expect(await observeHourlyMaintenanceCron({ env: hourlyEnv, nowMs: hourlyNow, fetchImpl })).toEqual({
    code: 'CRON_METRICS_UNAVAILABLE',
    dueTicks: 12,
    fromUtc: '2026-11-23T22:17:00.000Z',
    throughUtc: '2026-11-24T09:17:00.000Z',
  });
});

it.each([
  { KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '30' },
  { KAIROS_CRON_MONITOR_FIRST_TICK_UTC: '2026-11-23T21:18:00Z', KAIROS_CRON_MONITOR_LAST_TICK_UTC: '' },
  { KAIROS_CRON_MONITOR_LAST_TICK_UTC: '2026-11-24T10:18:00Z' },
])('rejects a production schedule outside the hourly cadence %j', async (overrides) => {
  const fetchImpl = vi.fn<typeof fetch>();
  const result = await observeHourlyMaintenanceCron({
    env: { ...hourlyEnv, ...overrides }, nowMs: hourlyNow, fetchImpl,
  });
  expect(result).toEqual({ code: 'CRON_MONITOR_CONFIG_INVALID' });
  expect(fetchImpl).not.toHaveBeenCalled();
});
