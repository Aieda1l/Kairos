import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Log, LogLevel, Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { cleanupControlSchema, cleanupCron } from './lib/maintenance-cron-cleanup.mjs';
import { productionWatchdogSchema } from './lib/maintenance-cron-production-watchdog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const migrationsDir = new URL('../migrations/', import.meta.url);
const migrations = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const firstTick = Date.parse('2026-11-25T10:17:00Z');

const workerSource = `
  import { runMaintenanceCronCleanup } from './scripts/lib/maintenance-cron-cleanup.mjs';
  import { runProductionCronWatchdog } from './scripts/lib/maintenance-cron-production-watchdog.mjs';

  export default {
    async scheduled(controller, env) {
      // The Cron admission clock follows the dispatched event. D1 expiry fixtures
      // are deliberately far on either side of its real local database clock.
      const result = await runMaintenanceCronCleanup({controller, env, nowMs: controller.scheduledTime});
      await env.OPERATIONS.prepare('INSERT INTO probe_cleanup_results (body) VALUES (?)')
        .bind(JSON.stringify(result)).run();
    },
    async fetch(request, env) {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/watchdog') {
        return new Response(null, {status: 404});
      }
      const input = await request.json();
      let alerts = 0;
      const result = await runProductionCronWatchdog({
        ...input,
        operations: env.OPERATIONS,
        completion: await env.OPERATIONS.prepare(
          'SELECT last_tick_ms, state FROM cron_cleanup_control WHERE id = 1',
        ).first(),
        sendAlert: async () => { alerts++; },
      });
      return Response.json({alerts, result});
    },
  };
`;
const bundled = await build({
  stdin: { contents: workerSource, resolveDir: root, sourcefile: 'production-cron-probe.mjs' },
  bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'],
});
const watchdogCron = '4,19,34,49 * * * *';
const watchedWorker = 'synthetic-maintenance-target';
const token = 'production-watchdog-fixture-token';
const entryActivation = firstTick + 4 * hourMs;
const entryBundle = await build({
  stdin: {
    contents: `
      import watchdog from './scripts/maintenance-cron-production-watchdog-worker.mjs';
      export default {
        async scheduled(controller, env) {
          const wallClock = Date.now;
          Date.now = () => controller.scheduledTime;
          try { return await watchdog.scheduled(controller, env); }
          finally { Date.now = wallClock; }
        }
      };
    `,
    resolveDir: root,
    sourcefile: 'production-watchdog-entry-clock.mjs',
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'],
});
let externalRequests = 0;
let analyticsFixtures = 0;
const options = convertV4MiniflareOptions({
  host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.NONE),
  workers: [...['off', 'dry-run', 'apply'].map(mode => ({
    name: 'local-cron-' + mode,
    script: bundled.outputFiles[0].text,
    modules: true,
    compatibilityDate: '2026-10-06',
    bindings: { KAIROS_CRON_CLEANUP_MODE: mode },
    d1Databases: { DB: 'synthetic-cron-app', OPERATIONS: 'synthetic-cron-operations' },
    outboundService: () => {
      externalRequests++;
      return new Response(null, { status: 403 });
    },
  })), {
    name: 'local-production-watchdog-entry',
    script: entryBundle.outputFiles[0].text, modules: true, compatibilityDate: '2026-10-06',
    d1Databases: { OPERATIONS: 'synthetic-cron-operations' },
    email: { send_email: [{name:'EMAIL',destination_address:'test-watchdog@example.invalid'}] },
    bindings: {
      KAIROS_CRON_PRODUCTION_WATCHDOG_ENABLED: 'true',
      KAIROS_CRON_WATCHDOG_RECIPIENT: 'test-watchdog@example.invalid',
      KAIROS_CRON_MONITOR_WORKER: watchedWorker,
      CLOUDFLARE_CRON_ANALYTICS_ACCOUNT_ID: '1'.repeat(32),
      CLOUDFLARE_CRON_ANALYTICS_TOKEN: token,
    },
    outboundService: async (request) => {
      if (request.url !== 'https://api.cloudflare.com/client/v4/graphql'
        || request.headers.get('authorization') !== 'Bearer ' + token || request.method !== 'POST') {
        externalRequests++;
        return new Response(null, {status:403});
      }
      analyticsFixtures++;
      const query = await request.json();
      assert.equal(query.variables.scriptName, watchedWorker);
      assert.equal(query.variables.from, new Date(entryActivation).toISOString());
      return Response.json({data:{viewer:{accounts:[{workersInvocationsAdaptive:[{
        dimensions: {scriptName:watchedWorker,eventType:'cron',status:'scriptThrewException',
          datetimeMinute:new Date(entryActivation + minuteMs).toISOString()},
        sum:{requests:1,errors:1},
      }]}]}}});
    },
  }],
});
options.telemetry = { enabled: false };
const mf = new Miniflare(options);

async function executeSql(db, sql) {
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim()).filter(Boolean);
  for (const statement of statements) {
    assert.equal((await db.prepare(statement).run()).success, true);
  }
}

try {
  const db = await mf.getD1Database('DB', 'local-cron-apply');
  const operations = await mf.getD1Database('OPERATIONS', 'local-cron-apply');
  for (const file of migrations) {
    await executeSql(db, await readFile(new URL(file, migrationsDir), 'utf8'));
  }
  await executeSql(operations, cleanupControlSchema);
  await executeSql(operations, productionWatchdogSchema);
  await executeSql(operations, 'CREATE TABLE probe_cleanup_results (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  await executeSql(db, `
    INSERT INTO users (id) VALUES ('synthetic-held'), ('synthetic-healthy');
    INSERT INTO sync_all_runs VALUES
      ('synthetic-held', 'held', 1, '[]'),
      ('synthetic-healthy', 'expired', 1, '[]'),
      ('synthetic-healthy', 'future', 4102444800000, '[]');
    INSERT INTO operation_locks VALUES ('synthetic-held', 'source:canvas', 'synthetic-owner', 'running', 0, 0, 123);
  `);
  const rateEvent = db.prepare('INSERT INTO abuse_rate_events VALUES (?, ?, ?, 0, ?)');
  const event = (id, expires) => rateEvent.bind(id, 'A'.repeat(43), 'synthetic-healthy', expires);
  const oldEvents = Array.from({ length: 101 }, (_, index) => event('expired-' + index, index));
  await db.batch([...oldEvents, event('future', 4_102_444_800_000)]);

  const run = async (mode, tickMs = firstTick, cron = cleanupCron) => {
    const worker = await mf.getWorker('local-cron-' + mode);
    assert.equal((await worker.scheduled({ cron, scheduledTime: new Date(tickMs) })).outcome, 'ok');
    const row = await operations.prepare('SELECT body FROM probe_cleanup_results ORDER BY id DESC LIMIT 1').first();
    return JSON.parse(row.body);
  };
  const control = () => operations.prepare('SELECT * FROM cron_cleanup_control WHERE id = 1').first();
  const counts = { rateEvents: 100, runs: 1, oauthRequests: 0, bridgeRequests: 0 };
  const assertAppState = async (rateEvents, runIds) => {
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').first('n'), rateEvents);
    const runs = (await db.prepare('SELECT run_id FROM sync_all_runs ORDER BY run_id').all()).results;
    assert.deepEqual(runs.map(row => row.run_id), runIds);
    assert.equal(await db.prepare("SELECT state FROM operation_locks WHERE user_id = 'synthetic-held'").first('state'), 'running');
  };

  assert.deepEqual(await run('off'), { status: 'off' });
  assert.deepEqual(await run('apply'), { status: 'not-admitted' });
  assert.deepEqual(await run('dry-run', firstTick, '* * * * *'), { status: 'invalid-trigger' });
  assert.deepEqual(await run('dry-run'), { status: 'dry-run', tickMs: firstTick, counts });
  assert.deepEqual(await control(), {
    id: 1, apply_enabled: 0, apply_from_ms: 0, last_tick_ms: 0, state: 'idle', counts_json: null,
  });
  await assertAppState(102, ['expired', 'future', 'held']);

  const setGate = (enabled, start) => operations.prepare(
    'UPDATE cron_cleanup_control SET apply_enabled = ?, apply_from_ms = ? WHERE id = 1',
  ).bind(enabled, start).run();
  await setGate(1, firstTick);
  assert.deepEqual(await run('apply'), { status: 'applied', tickMs: firstTick, counts });
  await assertAppState(2, ['future', 'held']);
  const keptEvents = (await db.prepare('SELECT event_id FROM abuse_rate_events ORDER BY event_id').all()).results;
  assert.deepEqual(keptEvents.map(row => row.event_id), ['expired-100', 'future']);
  const receipt = await control();
  assert.deepEqual(receipt, {
    id: 1, apply_enabled: 1, apply_from_ms: firstTick, last_tick_ms: firstTick,
    state: 'success', counts_json: JSON.stringify(counts),
  });
  assert.deepEqual(await run('apply', firstTick + 1_000), { status: 'not-admitted' });
  assert.deepEqual(await control(), receipt);

  await setGate(0, firstTick);
  assert.deepEqual(await run('apply', firstTick + hourMs), { status: 'not-admitted' });
  assert.deepEqual(await control(), { ...receipt, apply_enabled: 0 });
  await assertAppState(2, ['future', 'held']);

  const watchdog = await mf.getWorker('local-cron-apply');
  const poll = async (observedAtMs, ticks) => {
    const response = await watchdog.fetch('http://localhost/watchdog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activationMs: firstTick, observedAtMs, ticks }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const tick = (offset, status) => ({ tickMs: firstTick + offset * hourMs, status });
  const incident = [tick(0, 'success'), tick(1, 'missing')];
  const firstPoll = firstTick + hourMs + 17 * minuteMs;
  const assertPoll = async (observedAtMs, ticks, expectedAlerts, code, dispatch) => {
    const { alerts, result } = await poll(observedAtMs, ticks);
    assert.equal(alerts, expectedAlerts);
    assert.equal(result.code, code);
    assert.equal(result.dispatch, dispatch);
  };
  await assertPoll(firstPoll, incident, 0, 'CRON_WATCHDOG_INACTIVE', 'none');
  await setGate(1, firstTick);
  await assertPoll(firstPoll, incident, 0, 'CRON_MISSING_PENDING', 'none');
  await assertPoll(firstPoll, incident, 0, 'CRON_WATCHDOG_ALREADY_OBSERVED', 'suppressed');
  await assertPoll(firstPoll + 15 * minuteMs, incident, 1, 'CRON_OVERDUE', 'accepted');
  await assertPoll(firstPoll + 30 * minuteMs, incident, 0, 'CRON_OVERDUE', 'suppressed');

  const incidentId = () => operations.prepare('SELECT incident_id FROM cron_watchdog_production_state WHERE id = 1').first('incident_id');
  const firstIncidentId = await incidentId();
  assert.ok(firstIncidentId);
  const recoveryTime = firstTick + 2 * hourMs;
  const recovered = [...incident, tick(2, 'success')];
  await assertPoll(recoveryTime + 17 * minuteMs, recovered, 0, 'CRON_OVERDUE', 'suppressed');
  assert.equal(await incidentId(), firstIncidentId);
  assert.deepEqual(await run('apply', recoveryTime), {
    status: 'applied', tickMs: recoveryTime,
    counts: { ...counts, rateEvents: 1, runs: 0 },
  });
  await assertPoll(recoveryTime + 32 * minuteMs, recovered, 0, 'CRON_OK', 'none');
  assert.equal(await incidentId(), null);
  const secondFailure = [...recovered, tick(3, 'failure')];
  await assertPoll(firstTick + 3 * hourMs + 17 * minuteMs, secondFailure, 1, 'CRON_FAILED', 'accepted');
  await assertPoll(firstTick + 3 * hourMs + 32 * minuteMs, secondFailure, 0, 'CRON_FAILED', 'suppressed');

  assert.notEqual(await incidentId(), firstIncidentId);
  await setGate(0, firstTick);

  // Exact production Worker entry point and native simulated mail binding.
  // The only fixture adaptation is the clock and the provider response.
  const entry = await mf.getWorker('local-production-watchdog-entry');
  const scheduledEntry = offset => entry.scheduled({
    cron: watchdogCron, scheduledTime: new Date(entryActivation + offset),
  });
  assert.equal((await scheduledEntry(17 * minuteMs)).outcome, 'ok');
  assert.equal(analyticsFixtures, 0);
  await setGate(1, entryActivation);
  assert.equal((await scheduledEntry(17 * minuteMs)).outcome, 'ok');
  const state = () => operations.prepare('SELECT incident_id,mail_state FROM cron_watchdog_production_state WHERE id=1').first();
  const admitted = await state();
  assert.ok(admitted?.incident_id);
  assert.equal(admitted.mail_state, 'accepted');
  assert.equal((await scheduledEntry(32 * minuteMs)).outcome, 'ok');
  assert.deepEqual(await state(), admitted);
  assert.equal(analyticsFixtures, 2);
  await setGate(0, entryActivation);
  assert.equal(externalRequests, 0);
  console.log('Native Workerd production cron probe passed. Bounded cleanup, rollback, recovery, 2 mock alerts and native simulated mail verified with 0 external requests.');
} finally {
  await mf.dispose();
}
