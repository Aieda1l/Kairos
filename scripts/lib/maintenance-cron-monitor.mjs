const MINUTE_MS = 60_000;
const UTC_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/;
const UNAVAILABLE = 'CRON_METRICS_UNAVAILABLE';

export function parseUtcMinute(value) {
  if (typeof value !== 'string' || !UTC_MINUTE.test(value)) return NaN;
  const tick = Date.parse(value);
  if (!Number.isFinite(tick)) return NaN;
  const canonical = new Date(tick).toISOString();
  return value === canonical || value === canonical.replace('.000', '') ? tick : NaN;
}

function isDimensionLabel(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

export function classifyCronMetrics(payload, options) {
  return { code: summarizeCronMetrics(payload, options).code };
}

export function summarizeCronMetrics(payload, {
  worker, expectedTicks, nowMs, graceMs, limit,
} = {}) {
  if (!isDimensionLabel(worker)
    || !Array.isArray(expectedTicks) || expectedTicks.length === 0
    || !Number.isSafeInteger(nowMs)
    || !Number.isSafeInteger(graceMs) || graceMs < 0
    || !Number.isSafeInteger(limit) || limit <= 0) {
    return { code: UNAVAILABLE };
  }

  const ticks = new Set(expectedTicks);
  if (ticks.size !== expectedTicks.length || [...ticks].some((tick) =>
    !Number.isSafeInteger(tick) || tick % MINUTE_MS !== 0 || !Number.isFinite(new Date(tick).getTime())
  )) {
    return { code: UNAVAILABLE };
  }

  const errors = payload?.errors;
  const accounts = payload?.data?.viewer?.accounts;
  if ((errors != null && (!Array.isArray(errors) || errors.length > 0))
    || !Array.isArray(accounts) || accounts.length !== 1) {
    return { code: UNAVAILABLE };
  }
  const rows = accounts[0]?.workersInvocationsAdaptive;
  if (!Array.isArray(rows) || rows.length >= limit) return { code: UNAVAILABLE };

  const successes = new Map();
  for (const row of rows) {
    const { scriptName, eventType, status, datetimeMinute } = row?.dimensions ?? {};
    const { requests, errors: invocationErrors } = row?.sum ?? {};
    const tick = parseUtcMinute(datetimeMinute);
    if (scriptName !== worker || !isDimensionLabel(eventType)
      || !isDimensionLabel(status) || !Number.isFinite(tick)
      || !Number.isSafeInteger(requests) || requests <= 0
      || !Number.isSafeInteger(invocationErrors) || invocationErrors < 0 || invocationErrors > requests) {
      return { code: UNAVAILABLE };
    }
    if (eventType !== 'cron') continue;
    if (!ticks.has(tick) || successes.has(tick) || requests !== 1) return { code: UNAVAILABLE };
    successes.set(tick, status === 'success' && invocationErrors === 0);
  }

  let settledTicks = 0;
  let failedTicks = 0;
  let missingTicks = 0;
  for (const tick of ticks) {
    if (nowMs - tick < graceMs) continue;
    settledTicks++;
    if (successes.get(tick) === false) failedTicks++;
    if (!successes.has(tick)) missingTicks++;
  }
  if (settledTicks === 0) return { code: 'CRON_NOT_DUE' };
  const counts = { failedTicks, missingTicks };
  if (failedTicks > 0) return { code: 'CRON_FAILED', ...counts };
  if (missingTicks > 0) return { code: 'CRON_OVERDUE', ...counts };
  return { code: 'CRON_OK', ...counts };
}
