import {
  hourlyInvocationLagMinutes, parseUtcMinute, summarizeCronMetrics, summarizeHourlyCronMetrics,
} from './maintenance-cron-monitor.mjs';

const analyticsUrl = 'https://api.cloudflare.com/client/v4/graphql';
const minuteMs = 60_000;
const graceMs = 10 * minuteMs;
const lookbackMs = 12 * 60 * minuteMs;
const maximumBodyBytes = 512 * 1024;
const query = `query KairosCronMonitor($account: string, $scriptName: string, $from: string, $until: string, $limit: uint64!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: $limit, filter: {
      scriptName: $scriptName, eventType: "cron", datetime_geq: $from, datetime_lt: $until
    }) {
      dimensions { scriptName eventType status datetimeMinute }
      sum { requests errors }
    }
  } }
}`;

function configuration(env) {
  const account = env.CLOUDFLARE_CRON_ANALYTICS_ACCOUNT_ID;
  const token = env.CLOUDFLARE_CRON_ANALYTICS_TOKEN;
  const worker = env.KAIROS_CRON_MONITOR_WORKER;
  const interval = env.KAIROS_CRON_MONITOR_INTERVAL_MINUTES;
  const first = parseUtcMinute(env.KAIROS_CRON_MONITOR_FIRST_TICK_UTC);
  const lastValue = env.KAIROS_CRON_MONITOR_LAST_TICK_UTC;
  const last = lastValue ? parseUtcMinute(lastValue) : Infinity;
  const period = Number(interval) * minuteMs;
  if (typeof account !== 'string' || !/^[0-9a-f]{32}$/i.test(account)
    || typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{16,4096}$/.test(token)
    || typeof worker !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(worker)
    || !/^(?:[1-9]|[1-5]\d|60)$/.test(interval ?? '') || 60 % Number(interval) !== 0 || !Number.isFinite(first)
    || (lastValue && (!Number.isFinite(last) || last < first || (last-first) % period !== 0))) return null;
  return { account, token, worker, period, first, last };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing metrics body');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBodyBytes) throw new Error('Metrics body too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function observeMaintenanceCron(options) {
  return observeCron(options, false);
}

export function observeHourlyMaintenanceCron(options) {
  return observeCron(options, true);
}

async function observeCron({ env, nowMs = Date.now(), fetchImpl = fetch }, hourly) {
  const config = configuration(env);
  if (!config || !Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime())
    || (hourly && (env.KAIROS_CRON_MONITOR_INTERVAL_MINUTES !== '60' || new Date(config.first).getUTCMinutes() !== 17))) {
    return { code: 'CRON_MONITOR_CONFIG_INVALID' };
  }
  const { account, token, worker, period, first, last } = config;
  if (last < nowMs - lookbackMs) return { code: 'CRON_WINDOW_EXPIRED' };
  const newestIndex = Math.floor((Math.min(last, nowMs - graceMs) - first) / period);
  const oldestIndex = Math.max(0, Math.ceil((nowMs - lookbackMs - first) / period));
  if (newestIndex < oldestIndex) return { code: 'CRON_NOT_DUE' };
  const expectedTicks = Array.from({ length: newestIndex - oldestIndex + 1 }, (_, offset) => first + (oldestIndex + offset) * period);
  const fromUtc = new Date(expectedTicks[0]).toISOString();
  const throughUtc = new Date(expectedTicks.at(-1)).toISOString();
  // Adaptive buckets use the invocation minute, which can follow the scheduled minute.
  const queriedMinutes = hourly ? hourlyInvocationLagMinutes + 1 : 1;
  const until = new Date(expectedTicks.at(-1) + queriedMinutes * minuteMs).toISOString();
  const limit = expectedTicks.length * 2 + 1;
  const audit = { dueTicks: expectedTicks.length, fromUtc, throughUtc };
  try {
    const response = await fetchImpl(analyticsUrl, {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { account, scriptName: worker, from: fromUtc, until, limit } }),
    });
    if (!response.ok || response.redirected) {
      void response.body?.cancel().catch(() => {});
      return { code: 'CRON_METRICS_UNAVAILABLE', ...audit };
    }
    const summarize = hourly ? summarizeHourlyCronMetrics : summarizeCronMetrics;
    const result = summarize(await boundedJson(response), { worker, expectedTicks, nowMs, graceMs, limit });
    return { ...result, ...audit };
  } catch {
    return { code: 'CRON_METRICS_UNAVAILABLE', ...audit };
  }
}
