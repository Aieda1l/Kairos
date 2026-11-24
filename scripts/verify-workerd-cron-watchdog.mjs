import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Log, LogLevel, Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { watchdogStateSchema } from './lib/maintenance-cron-watchdog.mjs';

const root = new URL('./', import.meta.url);
const files = ['maintenance-cron-watchdog-worker.mjs', 'lib/maintenance-cron-observation.mjs',
  'lib/maintenance-cron-monitor.mjs', 'lib/maintenance-cron-watchdog.mjs'];
const probe = await Promise.all(files.map(async path => ({
  type: 'ESModule', path, contents: await readFile(new URL(path, root), 'utf8'),
})));
const anchor = Math.floor(Date.now() / 60_000) * 60_000 - 15 * 60_000;
const ticks = Array.from({ length: 3 }, (_, i) => new Date(anchor + i * 60_000).toISOString());
const worker = 'synthetic-cleanup-worker';
const cron = '* * * * *';
const recipient = 'watchdog-fixture@example.invalid';
const token = 'watchdog-local-fixture-no-secret';
let scenario = 'healthy';
let queries = 0;
let unexpectedEgress = 0;
const row = (tick, status = 'success') => ({
  dimensions: { scriptName: worker, eventType: 'cron', status, datetimeMinute: tick },
  sum: { requests: 1, errors: status === 'success' ? 0 : 1 },
});
const options = convertV4MiniflareOptions({
  host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.NONE),
  workers: [{
    name: 'local-cron-watchdog', compatibilityDate: '2026-10-06', modules: probe,
    d1Databases: { WATCHDOG_STATE: 'cron-watchdog-isolated-local' },
    email: { send_email: [{ name: 'EMAIL', destination_address: recipient }] },
    bindings: {
      KAIROS_CRON_WATCHDOG_ENABLED: 'true', KAIROS_CRON_WATCHDOG_TRIGGER: cron,
      KAIROS_CRON_WATCHDOG_PILOT: 'true',
      KAIROS_CRON_WATCHDOG_NOT_BEFORE_UTC: new Date(Date.now() - 60_000).toISOString(),
      KAIROS_CRON_WATCHDOG_EXPIRES_UTC: new Date(Date.now() + 60_000).toISOString(),
      KAIROS_CRON_WATCHDOG_RECIPIENT: recipient, KAIROS_CRON_MONITOR_WORKER: worker,
      KAIROS_CRON_MONITOR_FIRST_TICK_UTC: ticks[0], KAIROS_CRON_MONITOR_LAST_TICK_UTC: ticks[2],
      KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '1',
      CLOUDFLARE_CRON_ANALYTICS_ACCOUNT_ID: 'f'.repeat(32), CLOUDFLARE_CRON_ANALYTICS_TOKEN: token,
    },
    outboundService: async (request) => {
      if (request.url !== 'https://api.cloudflare.com/client/v4/graphql' || request.method !== 'POST'
        || request.headers.get('authorization') !== 'Bearer ' + token) {
        unexpectedEgress++;
        return new Response(null, { status: 403 });
      }
      queries++;
      const payload = await request.json();
      assert.equal(payload.variables.scriptName, worker);
      assert.equal(payload.variables.from, ticks[0]);
      if (scenario === 'unavailable') return Response.json({ errors: [{ message: 'private fixture' }] });
      const rows = scenario === 'joint'
        ? [row(ticks[0]), row(ticks[1], 'scriptThrewException')]
        : ticks.map(tick => row(tick));
      return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } } });
    },
  }],
});
options.telemetry = { enabled: false };
const mf = new Miniflare(options);
try {
  const db = await mf.getD1Database('WATCHDOG_STATE');
  assert.equal((await db.prepare(watchdogStateSchema).run()).success, true);
  const runtime = await mf.getWorker();
  const time = Date.now();
  const dispatch = (offset, expression = cron) => runtime.scheduled({ cron: expression, scheduledTime: new Date(time + offset) });
  const state = () => db.prepare('SELECT * FROM cron_watchdog_state').first();
  const goodTick = async offset => assert.equal((await dispatch(offset)).outcome, 'ok');
  assert.equal((await dispatch(0, '*/5 * * * *')).outcome, 'ok');
  assert.equal(queries, 0);
  await goodTick(1);
  assert.equal(await state(), null);

  scenario = 'joint';
  await goodTick(2);
  const originalIncident = await state();
  assert.equal(originalIncident.mail_state, 'accepted');
  assert(typeof originalIncident.incident_id === 'string' && originalIncident.incident_id.length > 0);
  await goodTick(2);
  await goodTick(3);
  assert.equal((await state()).incident_id, originalIncident.incident_id);

  scenario = 'unavailable';
  let unavailable = false;
  try { unavailable = (await dispatch(4)).outcome !== 'ok'; } catch { unavailable = true; }
  assert(unavailable);
  assert.equal((await state()).incident_id, originalIncident.incident_id);
  scenario = 'healthy';
  await goodTick(5);
  assert.equal((await state()).incident_id, originalIncident.incident_id);

  assert.equal(queries, 6);
  assert.equal(unexpectedEgress, 0);
  console.log(JSON.stringify({code:'CRON_WATCHDOG_NATIVE_PROBE_PASSED', analyticsFixtures:queries,
    simulatedMailAccepted:true, duplicateChecks:2, externalRequests:0}));
} finally { await mf.dispose(); }
