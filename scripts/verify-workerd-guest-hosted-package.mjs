// Local native proof. Proof entries, inspection endpoints and seals are never uploads.
import { Agent, buildConnector, fetch as localFetch } from 'undici';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyGuestHostedPackage, FIXTURE_SECRET_NAMES } from './lib/guest-hosted-package.mjs';
import { canonical, sha256 } from './lib/guest-hosted-build.mjs';
import { loadGuestHostedSchemas, runGuestHostedDiagnostic } from './lib/guest-hosted-diagnostic.mjs';
import { createNativeRequestAdapter, makeGuestWorkload, NATIVE_INVENTORY as inventory, NATIVE_PACKAGE_DIGEST as digest, preserveAdmissions, tableDigest } from './lib/guest-hosted-native.mjs';

const root = resolve('artifacts/guest-hosted/package-h1-native-fix1');
const evidence = resolve('artifacts/guest-hosted/h2-native');
const assert = value => { if (!value) throw new Error('GUEST_NATIVE_ASSERTION_FAILED'); };
const same = (a, b) => canonical(a) === canonical(b);
const bounded = async (work, ms = 10000) => {
  let timer;
  try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GUEST_NATIVE_TIMEOUT')), ms); })]); }
  finally { clearTimeout(timer); }
};
// Capture occurs after the real prelude and before application evaluation.
const proofEntry = `import './prelude.mjs';import {early} from './proof-capture.mjs';import candidate from './entry.mjs';import {fixtureFetch} from './prelude.mjs';let active=0,tasks=0;export default {async fetch(request,env,ctx){if(request.url==='https://driver.invalid/quiescence')return Response.json({active,tasks});if(request.url==='https://driver.invalid/aliases'){let checks=0;const natural=globalThis[Symbol.for('vinext.fetchCache.originalFetch')];for(const transport of [fetch,early,natural]){if(typeof transport!=='function')throw Error('GUEST_ALIAS_MISSING');const response=await transport('https://canvas.uw.edu/feeds/calendars/hosted-smoke.ics',{redirect:'manual'});if(!response.ok)throw Error('GUEST_ALIAS_FAILED');await response.arrayBuffer();checks++;}let denied=0;for(const [input,init]of [['https://escape.invalid/',{redirect:'manual'}],[new URL('https://fixture.invalid/reset'),{redirect:'manual'}],[new Request('https://canvas.uw.edu/feeds/calendars/hosted-smoke.ics',{redirect:'follow'}),undefined],['https://canvas.uw.edu/feeds/calendars/hosted-smoke.ics',{method:'POST',redirect:'manual'}]]){try{await early(input,init);}catch(error){if(error.message!=='GUEST_TRANSPORT_DENIED')throw error;denied++;}}return Response.json({natural:natural===fixtureFetch,early:early===fixtureFetch,checks,denied});}active++;const context={waitUntil(promise){tasks++;ctx.waitUntil(Promise.resolve(promise).finally(()=>tasks--));},passThroughOnException(){ctx.passThroughOnException();}};try{return await candidate.fetch(request,env,context);}finally{active--;}}};`;
const sinkScript = `let attempts=0;export default{fetch(request){if(request.url==='https://driver.invalid/stats')return Response.json({attempts});attempts++;return new Response('DENIED',{status:502});}};`;
const absentEntry = `import './prelude.mjs';import candidate from './entry.mjs';import {fixtureFetch} from './prelude.mjs';export default {async fetch(){try{await fixtureFetch('https://canvas.uw.edu/feeds/calendars/hosted-smoke.ics',{redirect:'manual'});return Response.json({denied:false});}catch(error){return Response.json({denied:error.message==='GUEST_TRANSPORT_DENIED',application:typeof candidate.fetch==='function'});}}};`;

let mf, absent, agent;
let result = { schemaVersion: 1, status: 'incomplete', code: 'GUEST_NATIVE_FAILED', nativeOnly: true, hostedExecution: false, packageDigest: digest };
try {
  assert(process.argv.length === 2);
  await mkdir(evidence, { recursive: true });
  const verified = await verifyGuestHostedPackage({ manifestPath: join(root, 'manifest.json'), inventory, mode: 'offline' });
  assert(verified.packageDigest === digest);
  const { schemas, provenance } = await loadGuestHostedSchemas();
  const moduleFiles = verified.manifest.uploadFiles.filter(path => !path.startsWith('fixture/'));
  const modules = await Promise.all(moduleFiles.map(async path => ({ type: 'ESModule', path: join(root, path), contents: await readFile(join(root, path), 'utf8') })));
  const fixtureModules = await Promise.all(verified.manifest.uploadFiles.filter(path => path.startsWith('fixture/')).map(async path => ({ type: 'ESModule', path: join(root, path), contents: await readFile(join(root, path), 'utf8') })));
  // UploadFiles are modules only; setup/config/migration files remain outside worker imports.
  assert(fixtureModules.length === 4);
  const proofModules = [{ type: 'ESModule', path: join(root, 'proof-entry.mjs'), contents: proofEntry }, ...modules, { type: 'ESModule', path: join(root, 'proof-capture.mjs'), contents: 'export const early=globalThis.fetch;' }];
  const secrets = { GUEST_OPERATOR_SECRET: randomUUID(), KAIROS_ABUSE_KEY_V1: randomBytes(32).toString('base64url'), KAIROS_TURNSTILE_SITE_KEY: randomUUID(), KAIROS_TURNSTILE_SECRET_KEY: randomUUID(), GUEST_FIXTURE_CHALLENGE_TOKEN: randomUUID(), GUEST_FIXTURE_ED_SMOKE_TOKEN: randomUUID(), GUEST_FIXTURE_ED_NEAR_TOKEN: randomUUID() };
  const sensitiveValues = Object.values(secrets);
  const base = 'https://' + inventory.hostname;
  const bindings = { ...secrets, KAIROS_GUEST_ENABLED: 'true', KAIROS_APP_URL: base, KAIROS_ABUSE_TRUSTED_INGRESS: 'cloudflare' };
  const shared = { compatibilityDate: '2026-10-06', compatibilityFlags: ['nodejs_compat'], outboundService: 'deny' };
  const options = convertV4MiniflareOptions({ cf: false, https: true, log: new Log(LogLevel.NONE), workers: [
    { ...shared, name: 'candidate', routes: [inventory.hostname + '/*'], modules: proofModules, modulesRoot: root, bindings, d1Databases: { DB: 'h2-app-' + randomUUID() }, serviceBindings: { GUEST_FIXTURE: 'fixture', ASSETS: 'deny' } },
    { ...shared, name: 'fixture', modules: fixtureModules, modulesRoot: root, bindings: Object.fromEntries(FIXTURE_SECRET_NAMES.map(key => [key, secrets[key]])), d1Databases: { FIXTURE_DB: 'h2-fixture-' + randomUUID() } },
    { ...shared, name: 'deny', modules: true, script: sinkScript }
  ] });
  options.telemetry = { enabled: false };
  mf = new Miniflare(options);
  const runtimeUrl = await bounded(() => mf.ready);
  const appDb = await mf.getD1Database('DB', 'candidate'), fixtureDb = await mf.getD1Database('FIXTURE_DB', 'fixture');
  const localD1Observed = { setup: { app: { statements: 0, rowsRead: 0, rowsWritten: 0 }, fixture: { statements: 0, rowsRead: 0, rowsWritten: 0 } }, observer: { app: { statements: 0, rowsRead: 0, rowsWritten: 0 }, fixture: { statements: 0, rowsRead: 0, rowsWritten: 0 } } };
  const sql = async (db, statement, phase, name) => {
    const response = await bounded(() => db.prepare(statement).all());
    assert(response.success && Array.isArray(response.results));
    const cost = localD1Observed[phase][name];
    cost.statements++;
    assert(Number.isFinite(response.meta.rows_read) && Number.isFinite(response.meta.rows_written));
    cost.rowsRead += response.meta.rows_read; cost.rowsWritten += response.meta.rows_written;
    return response.results;
  };
  for (const file of [...(await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort().map(name => 'migrations/' + name), 'fixture/control-schema.sql', 'fixture/setup.sql']) {
    const fixture = file.startsWith('fixture/');
    for (const statement of (await readFile(join(root, file), 'utf8')).replace(/--[^\n]*/g, '').split(';').map(value => value.trim()).filter(Boolean)) await sql(fixture ? fixtureDb : appDb, statement, 'setup', fixture ? 'fixture' : 'app');
  }
  await sql(appDb, "INSERT INTO abuse_rate_events(event_id,key_hash,user_id,admitted_at_ms,purge_after_ms) VALUES('h2-prior-synthetic','" + 'a'.repeat(43) + "',NULL,0,4102444800000)", 'setup', 'app');
  const connector = buildConnector({ rejectUnauthorized: false });
  agent = new Agent({ connect(options, callback) {
    if (options.hostname !== inventory.hostname || options.protocol !== 'https:' || options.port && String(options.port) !== '443') return callback(new Error('GUEST_LOCAL_TARGET_DENIED'), null);
    return connector({ ...options, hostname: '127.0.0.1', host: '127.0.0.1', port: runtimeUrl.port, servername: options.hostname }, callback);
  } });
  const adapter = createNativeRequestAdapter({ origin: base, secrets, sensitiveValues, fetch: (url, init) => localFetch(url, { ...init, dispatcher: agent }) });
  const candidate = await mf.getWorker('candidate');
  const quiesce = async () => {
    if (!await adapter.quiesce()) return false;
    const end = Date.now() + 1000;
    do {
      const state = await bounded(async () => (await candidate.fetch('https://driver.invalid/quiescence')).json(), 1000);
      if (state.active === 0 && state.tasks === 0) return true;
      await new Promise(resolve => setTimeout(resolve, 1));
    } while (Date.now() < end);
    return false;
  };
  let priorAdmissions;
  const snapshot = async () => {
    assert(await quiesce());
    const tableRows = async (db, name) => {
      const names = (await sql(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY name", 'observer', name)).map(row => row.name);
      const rows = {};
      for (const table of names) {
        assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(table));
        rows[table] = await sql(db, 'SELECT * FROM "' + table + '"', 'observer', name);
      }
      return rows;
    };
    const app = await tableRows(appDb, 'app'), fixture = await tableRows(fixtureDb, 'fixture');
    assert(same(Object.keys(fixture), ['fixture_operation']));
    const admissions = app.abuse_rate_events;
    const preserved = priorAdmissions ? preserveAdmissions(priorAdmissions, admissions) : true;
    if (!priorAdmissions) priorAdmissions = admissions;
    return { tables: Object.fromEntries(Object.entries(app).map(([name, rows]) => [name, tableDigest(rows)])), identifiedAdmissions: admissions.filter(row => row.user_id !== null).length, priorAdmissionsPreserved: preserved, fixtureTables: Object.fromEntries(Object.entries(fixture).map(([name, rows]) => [name, tableDigest(rows)])), fixture: Object.fromEntries(fixture.fixture_operation.map(row => [row.operation, { runId: row.run_id, scenario: row.scenario, cap: row.call_cap, calls: row.calls }])) };
  };
  const diagnostic = await runGuestHostedDiagnostic({ verifiedPackage: verified, targetOrigin: base, workload: makeGuestWorkload(), request: adapter.request, observations: { before: snapshot, quiesce, after: snapshot }, schemas, sensitiveValues });
  result.diagnostic = diagnostic;
  assert(diagnostic.status === 'passed' && diagnostic.attempted === 13 && diagnostic.completed === 13);
  assert(diagnostic.observation.appAdmissions === 28 && diagnostic.observation.fixtureAdmissions === 10);
  assert(Object.keys(diagnostic.observation.tablesBefore).length === 22 && Object.keys(diagnostic.observation.tablesBefore).filter(name => name !== 'abuse_rate_events').length === 21);
  assert(diagnostic.observation.tablesBefore.abuse_rate_events.count === 1 && diagnostic.observation.tablesAfter.abuse_rate_events.count === 29);
  assert(diagnostic.observation.identifiedAdmissionsAfter === 0 && diagnostic.observation.priorAdmissionsPreserved);

  // All additional H1 transport/cap/fault probes start strictly after the baseline.
  const ingressDenials = await bounded(() => Promise.all([
    { path: '/api/auth/session', method: 'GET', status: 404, operator: secrets.GUEST_OPERATOR_SECRET },
    { path: '/api/health', method: 'POST', status: 404, operator: secrets.GUEST_OPERATOR_SECRET },
    { path: '/api/health', method: 'GET', status: 403, operator: randomUUID() }
  ].map(async probe => {
    const response = await localFetch(base + probe.path, { method: probe.method, redirect: 'manual', headers: { origin: base, 'x-guest-operator': probe.operator }, dispatcher: agent });
    assert(response.status === probe.status && (await response.text()).length <= 256);
    return response.status;
  })));
  const aliases = await bounded(async () => (await candidate.fetch('https://driver.invalid/aliases')).json());
  assert(same(aliases, { natural: true, early: true, checks: 3, denied: 4 }));
  const fixtureWorker = await mf.getWorker('fixture');
  const race = await bounded(() => Promise.all(Array.from({ length: 6 }, async () => {
    const response = await fixtureWorker.fetch('https://canvas.uw.edu/feeds/calendars/hosted-smoke.ics', { redirect: 'manual' });
    await response.arrayBuffer(); return response.status;
  })));
  assert(race.filter(status => status === 200).length === 4 && race.filter(status => status === 503).length === 2);
  await bounded(async () => {
    const unknown = await fixtureWorker.fetch('https://fixture.invalid/reset', { redirect: 'manual' });
    assert(unknown.status === 502 && await unknown.text() === 'GUEST_FIXTURE_DENIED');
  });
  await bounded(() => fixtureDb.prepare('DROP TABLE fixture_operation').run());
  await bounded(async () => {
    const broken = await fixtureWorker.fetch('https://canvas.uw.edu/feeds/calendars/hosted-near.ics', { redirect: 'manual' });
    assert(broken.status === 503 && await broken.text() === 'GUEST_FIXTURE_UNAVAILABLE');
  });
  const outbound = await bounded(async () => (await (await mf.getWorker('deny')).fetch('https://driver.invalid/stats')).json());
  assert(outbound.attempts === 0);
  const absentOptions = convertV4MiniflareOptions({ cf: false, log: new Log(LogLevel.NONE), workers: [
    { ...shared, name: 'missing', modules: [{ type: 'ESModule', path: join(root, 'absent-entry.mjs'), contents: absentEntry }, ...modules], modulesRoot: root, bindings, d1Databases: { DB: 'h2-missing-' + randomUUID() }, serviceBindings: { ASSETS: 'deny' } },
    { ...shared, name: 'deny', modules: true, script: sinkScript }
  ] });
  absentOptions.telemetry = { enabled: false };
  absent = new Miniflare(absentOptions);
  await bounded(() => absent.ready);
  const missingBinding = await bounded(async () => (await (await absent.getWorker('missing')).fetch(base + '/api/health')).json());
  assert(same(missingBinding, { denied: true, application: true }));
  const absentOutbound = await bounded(async () => (await (await absent.getWorker('deny')).fetch('https://driver.invalid/stats')).json());
  assert(absentOutbound.attempts === 0);
  const sourceFiles = ['scripts/verify-workerd-guest-hosted-package.mjs', 'scripts/run-guest-hosted-diagnostic.mjs', 'scripts/lib/guest-hosted-native.mjs', 'scripts/lib/guest-hosted-diagnostic.mjs'];
  const driverInputs = await Promise.all(sourceFiles.map(async path => ({ path, sha256: sha256(await readFile(path)) })));
  const proof = { implementationRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), applicationRevision: verified.manifest.applicationRevision, packageDigest: digest, driverInputs, schema: provenance, local: { cf: false, telemetry: false, persist: false, ingress: 'exact-proposed-hostname-owned-loopback-tls', tls: 'self-signed-relaxation-local-only', syntheticClientAddress: true, platformExcluded: ['_cf_METADATA', 'sqlite_%'] }, uploadModules: [...modules, ...fixtureModules].map(module => ({ path: module.path.slice(root.length + 1).replaceAll('\\', '/'), sha256: sha256(module.contents) })), proofOnlyModules: [{ path: 'proof-entry.mjs', sha256: sha256(proofEntry) }, { path: 'proof-capture.mjs', sha256: sha256('export const early=globalThis.fetch;') }, { path: 'absent-entry.mjs', sha256: sha256(absentEntry) }, { path: 'rejecting-sink.mjs', sha256: sha256(sinkScript) }] };
  await writeFile(join(evidence, 'provenance.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
  result = { ...result, status: 'passed', code: 'GUEST_NATIVE_VALIDATED', diagnostic, proofSha256: sha256(canonical(proof)), localD1Observed, extraProbes: { outsideBaseline: true, ingressDenials, aliases, capRace: { admitted: 4, exhausted: 2 }, unknownDestinationDenied: true, fixtureStoreFailureDenied: true, missingBindingDenied: true }, outboundAttempts: 0, protectedTables: 21, totalAppTables: 22, nearOutputCounts: [2000, 2000, 500, 500, 1000, 1000], applicationRevision: proof.applicationRevision };
} catch { process.exitCode = 1; }
finally {
  let disposed = true;
  for (const runtime of [absent, mf]) if (runtime) try { await bounded(() => runtime.dispose()); } catch { disposed = false; }
  if (agent) try { await bounded(() => agent.destroy()); } catch { disposed = false; }
  result.disposed = disposed;
  if (!disposed || result.status !== 'passed') { result.status = 'incomplete'; result.code = 'GUEST_NATIVE_FAILED'; process.exitCode = 1; }
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, 'receipt.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  const files = ['receipt.json', ...(result.proofSha256 ? ['provenance.json'] : [])];
  const index = await Promise.all(files.map(async path => ({ path, sha256: sha256(await readFile(join(evidence, path))) })));
  await writeFile(join(evidence, 'hash-index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ status: result.status, code: result.code, disposed }));
}
