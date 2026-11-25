import { expect, it } from 'vitest';
import { classifyCronMetrics, summarizeCronMetrics } from '../../scripts/lib/maintenance-cron-monitor.mjs';

const worker = 'kairos-maintenance';
const firstMinute = '2026-11-24T04:00:00Z';
const nextMinute = '2026-11-24T04:05:00Z';
const firstTick = Date.parse(firstMinute);
const nextTick = Date.parse(nextMinute);
const options = {
  worker,
  expectedTicks: [firstTick, nextTick],
  nowMs: nextTick + 120_000,
  graceMs: 120_000,
  limit: 10,
};

function row(
  minute: string,
  dimensions: Partial<{ scriptName: string; eventType: string; status: string }> = {},
  sum = { requests: 1, errors: 0 },
) {
  return {
    dimensions: { scriptName: worker, eventType: 'cron', status: 'success', datetimeMinute: minute, ...dimensions },
    sum,
  };
}

function metrics(rows: unknown[], errors: unknown = []) {
  return { data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } }, errors };
}

it('requires a clean success for every settled tick', () => {
  const payload = metrics([
    row(nextMinute),
    row(firstMinute, { eventType: 'fetch' }),
    row(firstMinute),
  ], null);
  expect(classifyCronMetrics(payload, options)).toEqual({ code: 'CRON_OK' });
  expect(summarizeCronMetrics(payload, options)).toEqual({
    code: 'CRON_OK', failedTicks: 0, missingTicks: 0,
  });
});

it('holds a missing slot until the end of its grace period', () => {
  const payload = metrics([row(firstMinute)]);
  expect(classifyCronMetrics(payload, { ...options, nowMs: options.nowMs - 1 }))
    .toEqual({ code: 'CRON_OK' });
  expect(classifyCronMetrics(payload, options)).toEqual({ code: 'CRON_OVERDUE' });
});

it('returns not due when no expected slot has settled', () => {
  const payload = metrics([row(firstMinute, { status: 'scriptThrewException' }, { requests: 1, errors: 1 })]);
  expect(classifyCronMetrics(payload, { ...options, nowMs: firstTick + options.graceMs - 1 }))
    .toEqual({ code: 'CRON_NOT_DUE' });
});

it('prioritizes a validated failure over a missing settled slot', () => {
  const payload = metrics([row(firstMinute, { status: 'scriptThrewException' }, { requests: 1, errors: 1 })]);
  expect(classifyCronMetrics(payload, options)).toEqual({ code: 'CRON_FAILED' });
});

it('treats a successful status with a counted error as failed', () => {
  const payload = metrics([row(firstMinute, {}, { requests: 1, errors: 1 }), row(nextMinute)]);
  expect(classifyCronMetrics(payload, options)).toEqual({ code: 'CRON_FAILED' });
});

it.each([
  ['GraphQL errors', metrics([row(firstMinute), row(nextMinute)], [{ message: 'synthetic-private-value' }])],
  ['malformed errors', metrics([], '')],
  ['missing data', { data: null }],
  ['multiple accounts', { data: { viewer: { accounts: [{}, {}] } } }],
  ['missing dataset', { data: { viewer: { accounts: [{}] } } }],
  ['a cross-worker row', metrics([row(firstMinute, { scriptName: 'other-worker' })])],
  ['an unexpected cron minute', metrics([row('2026-11-24T04:01:00Z')])],
  ['an unaligned minute', metrics([row('2026-11-24T04:00:01Z')])],
  ['an impossible date', metrics([row('2026-11-31T04:00:00Z')])],
  ['a malformed status', metrics([row(firstMinute, { status: '' })])],
  ['a padded status', metrics([row(firstMinute, { status: 'success ' })])],
  ['a padded event type', metrics([row(firstMinute, { eventType: ' cron' })])],
  ['a missing dimension', metrics([{ dimensions: {}, sum: { requests: 1, errors: 0 } }])],
  ['a null row', metrics([null])],
  ['duplicate groups', metrics([row(firstMinute), row(firstMinute)])],
  ['conflicting groups', metrics([row(firstMinute), row(firstMinute, { status: 'scriptThrewException' })])],
  ['multiple requests in a group', metrics([row(firstMinute, {}, { requests: 2, errors: 0 })])],
  ['a fractional request count', metrics([row(firstMinute, {}, { requests: 1.5, errors: 0 })])],
  ['a row without requests', metrics([row(firstMinute, {}, { requests: 0, errors: 0 })])],
  ['more errors than requests', metrics([row(firstMinute, {}, { requests: 1, errors: 2 })])],
])('reports unavailable for %s', (_description, payload) => {
  expect(classifyCronMetrics(payload, options)).toEqual({ code: 'CRON_METRICS_UNAVAILABLE' });
});

it('reports unavailable when results hit the query limit', () => {
  expect(classifyCronMetrics(metrics([row(firstMinute), row(nextMinute)]), { ...options, limit: 2 }))
    .toEqual({ code: 'CRON_METRICS_UNAVAILABLE' });
});

it.each([
  { expectedTicks: [] },
  { expectedTicks: [firstTick, firstTick] },
  { expectedTicks: [firstTick + 1] },
  { nowMs: Number.NaN },
  { graceMs: -1 },
  { limit: 0 },
])('reports unavailable for invalid timing or limit options %j', (overrides) => {
  expect(classifyCronMetrics(metrics([]), { ...options, ...overrides }))
    .toEqual({ code: 'CRON_METRICS_UNAVAILABLE' });
});
