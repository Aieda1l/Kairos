// Native local evidence only: no live provider, credential, account or deployment.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, Log, LogLevel, convertV4MiniflareOptions} from 'miniflare';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {emptyServerOnly, fixtureRequestId, fixtureWorkerEntry, guestWorkerEntry, instrumentCompiledGuest, sourceIdentity} from '../tests/helpers/guest-workerd-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const started = Date.now();
const directory = join(root, 'artifacts/guest-source-capacity', `${new Date().toISOString().replace(/[:.]/g, '-')}-native`);
await mkdir(directory, {recursive: true});
const report = {code: 'GUEST_NATIVE_TRANSPORT_FAILED', evidenceType: 'local-native-workerd', externalRequests: 0,
  isolation: {cf: false, telemetry: false, outboundService: 'outbound', fixtureOutboundService: 'deny', realCredentialBindings: false},
  productionWorkerCpuMs: null, productionIsolateMemoryBytes: null, productionD1Billing: null,
  protectedRowsWritten: null, results: [], phases: [], deniedTraffic: null};
const allMetrics = [];
let active;
let currentCase = 'build';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';

function check(name, condition, details = {}) {
  report.results.push({name, ok: Boolean(condition), ...details});
  assert(condition, name);
}
function sumMetrics(metrics) {
  const keys = ['statements', 'admissionStatements', 'admissionReadStatements', 'admissionWriteStatements', 'admissionRowsRead', 'admissionRowsWritten', 'readStatements', 'writeStatements', 'changes', 'protectedWriteStatements', 'accountStatements', 'rowsRead', 'rowsWritten', 'missingRowsRead', 'missingRowsWritten', 'requests'];
  return Object.fromEntries(keys.map(key => [key, metrics.reduce((sum, m) => sum + (m[key] ?? 0), 0)]));
}
async function snapshot(db, observerMetrics) {
  // D1 reserves _cf_METADATA and forbids its contents; it is not an app table.
  const selected = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY name").all();
  observerMetrics.push(selected.meta);
  return Object.fromEntries(await Promise.all(selected.results.map(async ({name}) => {
    const result = await db.prepare(`SELECT * FROM ${quote(name)}`).all();
    observerMetrics.push(result.meta);
    return [name, result.results.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))];
  })));
}
async function startPhase(name, scripts) {
  currentCase = name + ':initialize';
  const bindings = {KAIROS_GUEST_ENABLED: 'true', KAIROS_APP_URL: 'https://guest.invalid', KAIROS_ABUSE_TRUSTED_INGRESS: 'cloudflare',
    KAIROS_ABUSE_KEY_V1: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    KAIROS_TURNSTILE_SITE_KEY: 'synthetic-guest-site', KAIROS_TURNSTILE_SECRET_KEY: 'synthetic-guest-secret'};
  const shared = {modules: true, compatibilityDate: '2026-10-06', compatibilityFlags: ['nodejs_compat']};
  const options = convertV4MiniflareOptions({cf: false, log: new Log(LogLevel.NONE), workers: [
    // Driver-only header envelope preserves forged values through Miniflare's
    // proxy. Draining tiny synthetic inputs here is not request-body timing evidence.
    {...shared, name: 'ingress', script: `export default {async fetch(request,env){const headers=new Headers(request.headers);headers.set('host',headers.get('x-driver-host')??new URL(request.url).host);headers.set('origin',headers.get('x-driver-origin'));headers.set('cf-connecting-ip',headers.get('x-driver-network'));const target=headers.get('x-driver-worker')==='1'?env.SECOND:env.FIRST;for(const key of ['x-driver-network','x-driver-worker','x-driver-host','x-driver-origin'])headers.delete(key);const body=await request.arrayBuffer();return target.fetch(new Request(request.url,{method:request.method,headers,body}));}};`, serviceBindings: {FIRST: 'first', SECOND: 'second'}, outboundService: 'deny'},
    ...['first', 'second'].map(name => ({...shared, name, script: scripts.app, bindings, d1Databases: {DB: 'synthetic-guest'}, outboundService: 'outbound', serviceBindings: {ASSETS:()=>new Response(null,{status:404})}})),
    // App code cannot reach fixture administration via its outbound fetch.
    {...shared, name: 'outbound', script: `export default {fetch(request,env){return env.FIXTURE.fetch(new URL(request.url).origin==='http://fixture.invalid'?new Request('https://unexpected.invalid/'):request);}};`, serviceBindings: {FIXTURE: 'fixture'}, outboundService: 'deny'},
    {...shared, name: 'fixture', script: scripts.fixture, d1Databases: {DB: 'synthetic-guest'}, outboundService: 'deny'},
    {...shared, name: 'deny', script: `let attempts=0;export default {fetch(request){if(new URL(request.url).origin==='http://driver.invalid')return Response.json({attempts});attempts++;return new Response(null,{status:502});}};`, outboundService: 'deny'},
  ]});
  options.telemetry = {enabled: false};
  const mf = new Miniflare(options);
  active = mf;
  await mf.ready;
  const db = await mf.getD1Database('DB', 'first');
  // Real migrations, no user/session/source inserts and no cleanup activation.
  const migrationMetrics = [];
  for (const file of (await readdir(join(root, 'migrations'))).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
    const sql = await readFile(join(root, 'migrations', file), 'utf8');
    for (const statement of sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)) {
      const result = await db.prepare(statement).run();
      migrationMetrics.push(result.meta);
    }
  }
  const observerMetrics = [];
  const phase = {name, mf, db, fixture: await mf.getWorker('fixture'),
    before: await snapshot(db, observerMetrics), metrics: [], started: Date.now(), migrationMetrics, observerMetrics};
  return phase;
}
async function finishPhase(phase) {
  const after = await snapshot(phase.db, phase.observerMetrics);
  const stats = await (await phase.fixture.fetch('http://fixture.invalid/stats')).json();
  const deny = await (await (await phase.mf.getWorker('deny')).fetch('http://driver.invalid/stats')).json();
  const expected = structuredClone(phase.before);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(expected).sort(), 'application table set unchanged');
  for (const mutation of stats.controls) {
    const i = expected.abuse_controls.findIndex(r => r.control_key === mutation.before.control_key);
    assert.deepEqual(expected.abuse_controls[i], mutation.before, 'control fixture precondition');
    expected.abuse_controls[i] = mutation.after;
  }
  let protectedChanges = 0;
  const proof = {};
  for (const table of Object.keys(expected)) {
    if (table === 'abuse_rate_events') continue;
    expected[table].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const same = hash(expected[table]) === hash(after[table]);
    if (!same) protectedChanges++;
    proof[table] = {beforeRows: phase.before[table].length, afterRows: after[table].length,
      beforeSha256: hash(phase.before[table]), expectedSha256: hash(expected[table]), afterSha256: hash(after[table]), matchesExpected: same};
  }
  const rates = after.abuse_rate_events;
  check(phase.name + ': only declared anonymous admission rows written', rates.every(row => row.user_id === null
    && /^[A-Za-z0-9_-]{43}$/.test(row.key_hash) && Number.isSafeInteger(row.admitted_at_ms) && row.purge_after_ms - row.admitted_at_ms === 3600000));
  check(phase.name + ': protected full table snapshots unchanged except exact fixture controls', protectedChanges === 0);
  check(phase.name + ': sealed outbound destinations', stats.unexpectedAttempts === 0 && deny.attempts === 0);
  if (phase.name === 'concurrent-near-cap') check('concurrent fixture bytes independently bounded', stats.fixtureBytes === 6 * 2097088,
    {aggregateFixtureBytes: stats.fixtureBytes, perReadFixtureBytes: 2097088, concurrency: 6});
  const metrics = sumMetrics(phase.metrics);
  check(phase.name + ': no account lookups', metrics.accountStatements === 0);
  check(phase.name + ': guest writes only admission SQL', metrics.protectedWriteStatements === 0 && metrics.changes === rates.length);
  report.phases.push({name: phase.name, elapsedMs: Date.now() - phase.started, d1: metrics, rateRows: rates.length,
    nativeD1MetaQualification: 'Local Miniflare metadata only, not deployed billing; missing counters counted separately. Statement counts include attempted INSERTs that deny.',
    fixtureBytesQualification: 'Generated synthetic upstream bytes (plus emitted stall bytes), not proof all bytes were consumed by the app.',
    snapshotProof: proof, fixture: stats, rejectingSinkAttempts: deny.attempts, fixtureMigration: {statements: phase.migrationMetrics.length, meta: phase.migrationMetrics},
    observerD1: {statements: phase.observerMetrics.length, meta: phase.observerMetrics, productionBilling: null},
    inaccessibleInternalTables: ['sqlite_*', '_cf_METADATA'], snapshotScope: 'All application tables, including abuse_controls; no control exclusion.'});
  report.protectedRowsWritten = (report.protectedRowsWritten ?? 0) + protectedChanges;
  allMetrics.push(...phase.metrics);
  await phase.mf.dispose();
  active = undefined;
}
async function configure(phase, mode) {
  await phase.fixture.fetch('http://fixture.invalid/configure', {method: 'POST', body: JSON.stringify({mode})});
}
async function invoke(phase, path, {cookie, network = '192.0.2.1', worker = 0, origin = 'https://guest.invalid', host = 'guest.invalid'} = {}) {
  const started = performance.now();
  const payload = {schemaVersion: 1, requestId: fixtureRequestId, ...(path === '/session' ? {turnstileToken: 'synthetic-guest-' + crypto.randomUUID()} : path === '/canvas' ? {feedUrl: 'https://canvas.uw.edu/feeds/calendars/synthetic.ics'} : {token: 'synthetic-ed-secret', ...(path === '/lessons' ? {courseId: '12'} : {})})};
  const response = await phase.mf.dispatchFetch('https://guest.invalid' + path, {method: 'POST', headers: {
    'content-type': 'application/json', 'x-driver-network': network, 'x-driver-worker': String(worker), 'x-driver-host': host, 'x-driver-origin': origin, ...(cookie ? {cookie} : {}),
  }, body: JSON.stringify(payload)});
  const raw = await response.text();
  const body = JSON.parse(raw);
  const metrics = JSON.parse(response.headers.get('x-probe-metrics'));
  assert.equal(metrics.schemaValid, true, 'actual public response schema');
  phase.metrics.push(metrics);
  return {status: response.status, code: body.code, count: body.assignments?.length ?? body.courses?.length ?? body.lessons?.length,
    partial: body.report?.partial, metrics, elapsedMs: performance.now() - started, outputBytes: Buffer.byteLength(raw),
    cookie: response.headers.get('set-cookie')?.split(';')[0]};
}
async function session(phase, options = {}) {
  const result = await invoke(phase, '/session', options);
  assert.equal(result.status, 200, 'anonymous bootstrap without account credentials');
  assert(result.cookie?.startsWith('__Host-kairos-guest-sync='));
  return result.cookie;
}
function safeResult(result) {
  const {cookie, ...safe} = result;
  void cookie;
  return safe;
}

try {
  report.source = await sourceIdentity(root, ['scripts/verify-workerd-guest-sources.mjs', 'tests/helpers/guest-workerd-fixtures.mjs', 'src/app/api/guest/session/route.ts', 'src/app/api/guest/session/end/route.ts', 'src/app/api/guest/sources/canvas/feed/route.ts', 'src/app/api/guest/sources/ed/courses/route.ts', 'src/app/api/guest/sources/ed/lessons/route.ts', 'vite.config.ts', 'wrangler.jsonc', 'dist/server/index.js']);
  const bundle = async contents => (await build({stdin: {contents, resolveDir: root, sourcefile: 'guest-native-probe.ts', loader: 'ts'},
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent', plugins: [emptyServerOnly]})).outputFiles[0].text;
  const scripts = {app: await bundle(guestWorkerEntry), fixture: await bundle(fixtureWorkerEntry)};
  const schemas=await import('data:text/javascript;base64,'+Buffer.from(await bundle("export * from './src/lib/guest/sources/contracts';")).toString('base64'));

  currentCase='compiled:build';
  const compiled=(await build({entryPoints:[join(root,'dist/server/index.js')],bundle:true,write:false,format:'esm',platform:'browser',external:['node:*','cloudflare:*'],logLevel:'silent'})).outputFiles[0].text;
  report.compiled={entry:'dist/server/index.js',bundledSha256:createHash('sha256').update(compiled).digest('hex'),authIdentityCalendarCredentialBindings:false,fixtureFlags:false};
  const compiledPhase=await startPhase('compiled-anonymous-routes',{app:instrumentCompiledGuest(compiled),fixture:scripts.fixture});
  currentCase='compiled:wrong-origin';
  const beforeOrigin=await (await compiledPhase.fixture.fetch('http://fixture.invalid/stats')).json();
  const originResponse=await compiledPhase.mf.dispatchFetch('https://guest.invalid/api/guest/session',{method:'POST',headers:{'content-type':'application/json','x-driver-network':'192.0.2.1','x-driver-host':'guest.invalid','x-driver-origin':'https://forged.invalid'},body:JSON.stringify({schemaVersion:1,requestId:fixtureRequestId,turnstileToken:'synthetic-proof'})});
  const originMetrics=JSON.parse(originResponse.headers.get('x-probe-metrics')??'null'),originBody=await originResponse.json();
  const afterOrigin=await (await compiledPhase.fixture.fetch('http://fixture.invalid/stats')).json();
  check(currentCase+' guest envelope and private no-store',originResponse.status===403&&originResponse.headers.get('cache-control')==='no-store, private'&&schemas.guestApiErrorSchema.safeParse(originBody).success&&originBody.code==='UNTRUSTED_ORIGIN');
  check(currentCase+' no D1 account or upstream work',originMetrics!==null&&originMetrics.statements===0&&originMetrics.accountStatements===0&&originMetrics.protectedWriteStatements===0&&afterOrigin.providerRequests===beforeOrigin.providerRequests&&afterOrigin.challengeRequests===beforeOrigin.challengeRequests,{metrics:originMetrics});
  if(originMetrics)compiledPhase.metrics.push(originMetrics);
  let compiledCookie;
  for(const [path,fields,member] of [
    ['/api/guest/session',{turnstileToken:'synthetic-guest-'+crypto.randomUUID()},null],
    ['/api/guest/sources/canvas/feed',{feedUrl:'https://canvas.uw.edu/feeds/calendars/synthetic.ics'},'assignments'],
    ['/api/guest/sources/ed/courses',{token:'synthetic-ed-secret'},'courses'],
    ['/api/guest/sources/ed/lessons',{token:'synthetic-ed-secret',courseId:'12'},'lessons'],
  ]){
    currentCase='compiled:'+path;
    const networkBefore=await (await compiledPhase.fixture.fetch('http://fixture.invalid/stats')).json();
    const response=await compiledPhase.mf.dispatchFetch('https://guest.invalid'+path,{method:'POST',headers:{'content-type':'application/json','x-driver-network':'192.0.2.1','x-driver-host':'guest.invalid','x-driver-origin':'https://guest.invalid',...(compiledCookie?{cookie:compiledCookie}:{})},body:JSON.stringify({schemaVersion:1,requestId:fixtureRequestId,...fields})});
    const raw=await response.text(),metrics=JSON.parse(response.headers.get('x-probe-metrics')??'null');
    check(currentCase+' registered and composed',response.status===200&&metrics!==null,{status:response.status});
    // Compiled runtime fetch does not necessarily use globalThis.fetch. Measure
    // actual requests at the sealed destination, separately from driver controls.
    const networkAfter=await (await compiledPhase.fixture.fetch('http://fixture.invalid/stats')).json();
    const providerRequests=networkAfter.providerRequests-networkBefore.providerRequests;
    const challengeRequests=networkAfter.challengeRequests-networkBefore.challengeRequests;
    metrics.requests=providerRequests+challengeRequests;
    check(currentCase+' exact sealed destination requests',providerRequests===(member?1:0)&&challengeRequests===(member?0:1),{providerRequests,challengeRequests,measurement:'sealed fixture counters; driver stats excluded'});
    const payload=JSON.parse(raw);compiledPhase.metrics.push(metrics);
    const schema=member==='assignments'?schemas.guestCanvasFeedResponseSchema:member==='courses'?schemas.guestEdCoursesResponseSchema:member==='lessons'?schemas.guestEdLessonsResponseSchema:schemas.guestSessionResponseSchema;
    check(currentCase+' actual response schema',schema.safeParse(payload).success);
    check(currentCase+' public result',payload.ok===true&&payload.schemaVersion===1&&payload.requestId===fixtureRequestId&&(!member||payload[member]?.length===1));
    check(currentCase+' no account dependency',metrics.accountStatements===0&&metrics.protectedWriteStatements===0&&metrics.requests===1,{metrics});
    if(!member){compiledCookie=response.headers.get('set-cookie')?.split(';')[0];assert(compiledCookie?.startsWith('__Host-kairos-guest-sync='));}
    check(currentCase+' does not echo secrets',!raw.includes('synthetic-ed-secret')&&!raw.includes('synthetic.ics')&&!raw.includes(compiledCookie));
  }
  await finishPhase(compiledPhase);

  const transport = await startPhase('transport', scripts);
  const cookie = await session(transport);
  for (const [name, options, status] of [['no capability', {}, 401], ['forged origin', {cookie, origin: 'https://forged.invalid'}, 403], ['forged host', {cookie, host: 'forged.invalid'}, 403]]) {
    currentCase = name;
    const rejected = await invoke(transport, '/canvas', options);
    check(name + ' rejected before D1/upstream', rejected.status === status && rejected.metrics.statements === 0 && rejected.metrics.requests === 0, safeResult(rejected));
  }
  const cases = [
    ['/canvas', 'valid', 200, undefined, 1, 1], ['/canvas', 'redirect', 200, undefined, 6, 1],
    ['/canvas', 'escaped', 422, 'INVALID_FEED_URL', 1], ['/canvas', 'redirect-loop', 422, 'NETWORK_ERROR', 6],
    ['/canvas', 'empty', 200, undefined, 1, 0], ['/canvas', 'partial', 200, undefined, 1, 1],
    ['/canvas', 'no-events', 422, 'EMPTY_FEED', 1],
    ['/canvas', 'overflow', 422, 'SOURCE_RESULT_TOO_LARGE', 1], ['/canvas', 'utf8', 422, 'INVALID_ICAL', 1],
    ['/courses', 'valid', 200, undefined, 1, 1], ['/lessons', 'valid', 200, undefined, 1, 1],
    ['/courses', 'escaped', 422, 'ED_UPSTREAM_ERROR', 1], ['/courses', 'empty', 200, undefined, 1, 0],
    ['/lessons', 'empty', 200, undefined, 1, 0], ['/lessons', 'overflow', 422, 'SOURCE_RESULT_TOO_LARGE', 1],
    ['/lessons', 'utf8', 422, 'ED_PARSE_ERROR', 1], ['/canvas', 'stalled', 422, 'NETWORK_ERROR', 1],
  ];
  for (const [path, mode, status, code, requests, count] of cases) {
    currentCase = path + ':' + mode;
    await configure(transport, mode);
    const result = await invoke(transport, path, {cookie});
    check(currentCase, result.status === status && result.code === code && result.metrics.requests === requests
      && (count === undefined || result.count === count) && (mode !== 'partial' || result.partial === true)
      && (mode !== 'overflow' || result.metrics.bodyWithoutLength > 0)
      && (mode !== 'stalled' || (result.elapsedMs >= 14000 && result.elapsedMs < 20000)), safeResult(result));
  }
  for (const [path, mode] of [['/canvas', 'version'], ['/lessons', 'pause']]) {
    currentCase = path + ':' + mode;
    await configure(transport, mode);
    const result = await invoke(transport, path, {cookie});
    check(currentCase, result.status === 503 && result.code === 'SERVICE_UNAVAILABLE' && result.metrics.requests === 1, safeResult(result));
  }
  await configure(transport, 'valid');
  const paused = await invoke(transport, '/courses', {cookie});
  check('already paused provider performs no admission or fetch', paused.status === 503 && paused.metrics.admissionStatements === 0 && paused.metrics.requests === 0, safeResult(paused));
  await finishPhase(transport);

  const nearCap = await startPhase('concurrent-near-cap', scripts);
  const nearCookie = await session(nearCap);
  await configure(nearCap, 'near-cap');
  currentCase = 'bounded concurrent near-cap burst';
  const burstStart = performance.now();
  const burst = await Promise.all(['/canvas', '/canvas', '/courses', '/courses', '/lessons', '/lessons'].map((path, i) => invoke(nearCap, path, {cookie: nearCookie, worker: i % 2})));
  check(currentCase, burst.every((r, i) => r.status === 200 && r.count === [2000, 2000, 500, 500, 1000, 1000][i] && r.metrics.requests === 1),
    {concurrency: 6, services: 2, fixtureCounts: {canvasAssignmentsPerRead: 2000, edCoursesPerRead: 500, edRawLessonsPerRead: 2000, edVisibleLessonsPerRead: 1000},
      elapsedMs: performance.now() - burstStart, outputBytes: burst.reduce((sum, r) => sum + r.outputBytes, 0), calls: burst.map(safeResult)});
  await finishPhase(nearCap);

  const contention = await startPhase('independent-service-contention', scripts);
  const contentionCookie = await session(contention);
  await configure(contention, 'empty');
  currentCase = 'default session admission across independent services';
  const contested = await Promise.all(Array.from({length: 40}, (_, i) => invoke(contention, '/canvas', {cookie: contentionCookie, worker: i % 2})));
  const accepted = contested.filter(r => r.status === 200), denied = contested.filter(r => r.status === 429);
  check(currentCase, accepted.length === 30 && denied.length === 10 && denied.every(r => r.metrics.requests === 0),
    {concurrency: 40, services: 2, admitted: accepted.length, denied: denied.length, admittedD1: sumMetrics(accepted.map(r => r.metrics)), deniedD1: sumMetrics(denied.map(r => r.metrics))});
  await finishPhase(contention);

  const capacity = await startPhase('distributed-bootstrap-and-global-denial', scripts);
  await configure(capacity, 'empty');
  currentCase = 'distributed bootstrap independent of upstream global budget';
  // Distributed networks exercise the real default bootstrap budget, not a tuned cap.
  const sessions = await Promise.all(Array.from({length: 64}, async (_, i) => ({cookie: await session(capacity, {network: `198.51.100.${i + 1}`, worker: i % 2}), network: `198.51.100.${i + 1}`, worker: i % 2})));
  check(currentCase, sessions.length === 64, {concurrency: 64, bootstrapCount: 64, d1: sumMetrics(capacity.metrics)});
  currentCase = 'independent services share global sixty-read ceiling';
  const reads = await Promise.all(sessions.map(options => invoke(capacity, '/canvas', options)));
  check(currentCase, reads.filter(r => r.status === 200).length === 60 && reads.filter(r => r.status === 429).length === 4,
    {concurrency: 64, admitted: reads.filter(r => r.status === 200).length, denied: reads.filter(r => r.status === 429).length,
      admittedD1: sumMetrics(reads.filter(r => r.status === 200).map(r => r.metrics)), deniedD1: sumMetrics(reads.filter(r => r.status === 429).map(r => r.metrics))});
  currentCase = 'global denial retains prior network and session charges';
  const beforeDenial = await capacity.db.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').all();
  const denial = await invoke(capacity, '/canvas', sessions[0]);
  const afterDenial = await capacity.db.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').all();
  capacity.observerMetrics.push(beforeDenial.meta, afterDenial.meta);
  report.deniedTraffic = {admittedEvents: afterDenial.results[0].n - beforeDenial.results[0].n, upstreamRequests: denial.metrics.requests, status: denial.status, d1: denial.metrics};
  check(currentCase, denial.status === 429 && report.deniedTraffic.admittedEvents === 2 && report.deniedTraffic.upstreamRequests === 0, report.deniedTraffic);
  // A bootstrap denial has its own query cost and must not call Siteverify.
  const bootstraps = [];
  for (let i = 0; i < 10; i++) bootstraps.push(await invoke(capacity, '/session', {network: '198.51.100.1', worker: i % 2}));
  check('bootstrap network cap denies before challenge', bootstraps.filter(r => r.status === 200).length === 9
    && bootstraps.at(-1).status === 429 && bootstraps.at(-1).metrics.requests === 0,
    {accepted: 9, denied: 1, acceptedD1: sumMetrics(bootstraps.slice(0, 9).map(r => r.metrics)), deniedD1: bootstraps.at(-1).metrics});
  await finishPhase(capacity);

  assert.equal(report.externalRequests, 0);
  assert(report.results.every(result => result.ok === true));
  assert.equal(report.protectedRowsWritten, 0);
  assert.equal(report.deniedTraffic.admittedEvents, 2);
  assert.equal(report.deniedTraffic.upstreamRequests, 0);
  report.d1 = sumMetrics(allMetrics);
  report.code = 'GUEST_NATIVE_TRANSPORT_PASSED';
} catch (error) {
  // Never serialize request/response objects, credentials or raw upstream errors.
  report.failure = {case: currentCase, kind: error instanceof assert.AssertionError ? 'assertion' : error?.name ?? 'Error'};
  if (currentCase === 'build' || currentCase.endsWith(':initialize')) report.failure.harnessDiagnostic = error.message;
  process.exitCode = 1;
} finally {
  if (active) await active.dispose();
  report.elapsedMs = Date.now() - started;
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({...report, source: report.source ? {ref: report.source.ref, dirty: report.source.dirty} : null, receipt: join(directory, 'receipt.json')}));
}
