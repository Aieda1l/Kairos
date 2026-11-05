import { GUEST_LIMITS, GUEST_ROUTES, guestFixtureProtocol, verifyGuestHostedPackage } from './guest-hosted-package.mjs';
import { canonical, workspaceRoot } from './guest-hosted-build.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, join, dirname } from 'node:path';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => { const value = relative(root, path); return value !== '' && value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value); };
const trustedSchemas = new WeakMap();
export async function loadGuestHostedSchemas(options) {
  try { return await loadVerifiedSchemas(options?.verifiedPackage); }
  catch { throw new Error('GUEST_SCHEMA_SOURCE_INVALID'); }
}
async function loadVerifiedSchemas(verifiedPackage) {
  if (!verifiedPackage || verifiedPackage.mode !== 'offline' || typeof verifiedPackage.manifestPath !== 'string' || !verifiedPackage.manifest?.inventory) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const checked = await verifyGuestHostedPackage({ manifestPath: verifiedPackage.manifestPath, inventory: verifiedPackage.manifest.inventory, mode: 'offline' });
  if (checked.packageDigest !== verifiedPackage.packageDigest || canonical(checked.manifest) !== canonical(verifiedPackage.manifest)) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const manifest = checked.manifest;
  const buildReceiptHash = manifest.buildReceiptSha256;
  const bytes = await readFile(join(dirname(checked.manifestPath), 'build-receipt.json'));
  if (hash(bytes) !== buildReceiptHash) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const receipt = JSON.parse(bytes.toString('utf8'));
  if (receipt.status !== 'built' || receipt.applicationRevision !== manifest.applicationRevision || receipt.lockSha256 !== manifest.lockSha256 || hash(canonical(receipt.sourceInputs)) !== manifest.sourceInputsSha256) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const root = await realpath(receipt.sourceRoot), dependencies = await realpath(receipt.dependencyRoot);
  if (dependencies !== await realpath(join(workspaceRoot, 'node_modules'))) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const sourceHashes = new Map(receipt.sourceInputs.map(item => [item.path.replaceAll('/', sep), item.sha256]));
  const tsconfig = join(root, 'tsconfig.json');
  if (hash(await readFile(tsconfig)) !== sourceHashes.get('tsconfig.json')) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const lockBytes = await readFile(join(root, 'package-lock.json'));
  if (hash(lockBytes) !== receipt.lockSha256) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const zodManifest = await readFile(join(dependencies, 'zod', 'package.json'));
  let zodVersion, lockedVersion;
  try {
    zodVersion = JSON.parse(zodManifest.toString('utf8')).version;
    lockedVersion = JSON.parse(lockBytes.toString('utf8')).packages['node_modules/zod'].version;
  } catch { throw new Error('GUEST_SCHEMA_SOURCE_INVALID'); }
  if (typeof lockedVersion !== 'string' || !lockedVersion || zodVersion !== lockedVersion) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const banned = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
  const result = await build({
    stdin: { contents: "export * from './src/lib/guest/sources/contracts.ts';", resolveDir: root, sourcefile: 'guest-diagnostic-schemas.ts', loader: 'ts' },
    absWorkingDir: root, tsconfig, bundle: true, write: false, metafile: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
    plugins: [{ name: 'schema-capability-audit', setup(api) { api.onResolve({ filter: /.*/ }, args => { if (banned.has(args.path) || args.path === 'server-only' || args.path.startsWith('cloudflare:')) return { errors: [{ text: 'GUEST_SCHEMA_IMPORT_DENIED' }] }; }); } }]
  });
  if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(output => output.imports.length)) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  const inputs = [];
  for (const path of Object.keys(result.metafile.inputs)) {
    if (path === 'guest-diagnostic-schemas.ts' || path.startsWith('<')) continue;
    const absolute = await realpath(resolve(root, path));
    const digest = hash(await readFile(absolute));
    if (within(root, absolute)) {
      if (sourceHashes.get(relative(root, absolute)) !== digest) throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
      inputs.push({ path: relative(root, absolute).replaceAll(sep, '/'), sha256: digest });
    } else if (within(join(dependencies, 'zod'), absolute)) {
      inputs.push({ path: 'node_modules/' + relative(dependencies, absolute).replaceAll(sep, '/'), sha256: digest });
    } else throw new Error('GUEST_SCHEMA_SOURCE_INVALID');
  }
  inputs.sort((a, b) => a.path.localeCompare(b.path));
  const code = result.outputFiles[0].text;
  const schemas = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const identities = trustedSchemas.get(schemas) ?? new Set();
  identities.add(canonical({ packageDigest: checked.packageDigest, buildReceiptSha256: buildReceiptHash, applicationRevision: receipt.applicationRevision }));
  trustedSchemas.set(schemas, identities);
  return { schemas, provenance: { buildReceiptSha256: buildReceiptHash, applicationRevision: receipt.applicationRevision, node: process.version, esbuild: esbuildVersion, zodVersion, zodManifestSha256: hash(zodManifest), loaderSha256: hash(await readFile(fileURLToPath(import.meta.url))), lockSha256: receipt.lockSha256, inputs, outputSha256: hash(code), externalImports: 0 } };
}

const unavailable = reason => ({ value: null, reason });
function cacheDirectives(header) {
  const parts = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { parts.push(header.slice(start, i)); start = i + 1; }
  }
  if (quoted || escaped) return new Set();
  parts.push(header.slice(start));
  const bare = new Set();
  for (const part of parts) {
    const match = /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)(?:\s*=\s*(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[^"\\\r\n]|\\[^\r\n])*"))?\s*$/.exec(part);
    if (!match) return new Set();
    if (!part.includes('=')) bare.add(match[1].toLowerCase());
  }
  return bare;
}
function containsSensitive(payload, value) {
  const pending = [payload];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string' && current.includes(value)) return true;
    if (current && typeof current === 'object') {
      for (const [key, member] of Object.entries(current)) {
        if (key.includes(value)) return true;
        pending.push(member);
      }
    }
  }
  return false;
}
const bounded = (fn, ms, abort) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { abort?.(); reject(new Error('GUEST_TIMEOUT')); }, ms);
  Promise.resolve().then(fn).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
const denyResponse = response => {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* best effort */ }
  throw new Error('GUEST_RESPONSE_INVALID');
};

async function readBody(response, signal, limit) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) denyResponse(response);
  if (!response.body) throw new Error('GUEST_BODY_MISSING');
  const reader = response.body.getReader();
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ } };
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { cancel(); rejectAbort(new Error('GUEST_TIMEOUT')); };
  signal.addEventListener('abort', onAbort, { once: true });
  let finished = false;
  try {
    if (signal.aborted) throw new Error('GUEST_TIMEOUT');
    let bytes = 0;
    const chunks = [];
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new Error('GUEST_BODY_TOO_LARGE');
      chunks.push(part.value);
    }
    if (signal.aborted) throw new Error('GUEST_TIMEOUT');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const payload = JSON.parse(chunks.map((chunk, index) => decoder.decode(chunk, { stream: index !== chunks.length - 1 })).join(''));
    finished = true;
    return payload;
  } finally {
    if (!finished) cancel();
    signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* pending reader */ }
  }
}

export async function runGuestHostedDiagnostic({ verifiedPackage, targetOrigin, workload, request, observations, schemas, sensitiveValues = [] }) {
  if (typeof request !== 'function' || !observations || ['before', 'quiesce', 'after'].some(key => typeof observations[key] !== 'function')) throw new Error('GUEST_ADAPTER_REQUIRED');
  if (!verifiedPackage || verifiedPackage.mode !== 'offline' || !/^[a-f0-9]{64}$/.test(verifiedPackage.packageDigest ?? '') || verifiedPackage.manifest?.inventory?.hostname !== 'guest-diagnostic.mykairos.me') throw new Error('GUEST_PACKAGE_INVALID');
  if (targetOrigin !== 'https://guest-diagnostic.mykairos.me') throw new Error('GUEST_TARGET_INVALID');
  if (!Array.isArray(workload) || workload.length > GUEST_LIMITS.appRequests || workload.some(item => !GUEST_ROUTES.some(route => route.path === item?.path && route.method === item?.method))) throw new Error('GUEST_WORKLOAD_INVALID');
  if (workload.some(item => item.path !== '/api/health')) {
    const identity = canonical({ packageDigest: verifiedPackage.packageDigest, buildReceiptSha256: verifiedPackage.manifest.buildReceiptSha256, applicationRevision: verifiedPackage.manifest.applicationRevision });
    if (!schemas || !trustedSchemas.get(schemas)?.has(identity)) throw new Error('GUEST_SCHEMA_REQUIRED');
  }
  if (!Array.isArray(sensitiveValues)) throw new Error('GUEST_ADAPTER_REQUIRED');
  if (workload.some((item, index) => !Number.isSafeInteger(item.phase ?? 0) || (item.phase ?? 0) < 0 || (index > 0 && (item.phase ?? 0) < (workload[index - 1].phase ?? 0)))) throw new Error('GUEST_WORKLOAD_INVALID');
  const operations = guestFixtureProtocol(verifiedPackage.manifest.inventory).operations;
  const operationCaps = Object.fromEntries(operations.map(operation => [operation.key, operation.cap]));
  const requested = Object.fromEntries(operations.map(operation => [operation.key, 0]));
  const fixtureKey = item => item.case ? null : item.path.endsWith('/session') ? 'challenge' : item.path.endsWith('/feed') ? 'canvas-' + (item.near ? 'near' : 'smoke') : item.path.endsWith('/courses') ? 'ed-courses-' + (item.near ? 'near' : 'smoke') : item.path.endsWith('/lessons') ? 'ed-lessons-' + (item.near ? 'near' : 'smoke') : null;
  for (const item of workload) {
    if (item.case && !((item.case === 'wrong-origin' && item.path === '/api/guest/session') || (item.case === 'missing-capability' && item.path === '/api/guest/sources/ed/courses'))) throw new Error('GUEST_WORKLOAD_INVALID');
    if (item.near !== undefined && typeof item.near !== 'boolean') throw new Error('GUEST_WORKLOAD_INVALID');
    const key = fixtureKey(item);
    if (key && key !== 'challenge') {
      const count = item.near ? item.path.endsWith('/feed') ? 2000 : item.path.endsWith('/courses') ? 500 : 1000 : 1;
      if (item.expectedCount !== count) throw new Error('GUEST_WORKLOAD_INVALID');
    }
    if (key) requested[key]++;
  }
  if (Object.entries(requested).some(([key, value]) => value > operationCaps[key]) || Object.values(requested).reduce((a, b) => a + b, 0) > GUEST_LIMITS.fixtureAdmissions) throw new Error('GUEST_WORKLOAD_INVALID');
  const receipt = {
    schemaVersion: 1, status: 'incomplete', code: 'GUEST_EMPTY_WORKLOAD',
    packageDigest: verifiedPackage.packageDigest, attempted: 0, completed: 0,
    metrics: { perRequestCpuMs: unavailable('not_collected_under_logs_traces_off_contract'), peakMemoryBytes: unavailable('unsupported_by_selected_platform_metrics'), perRequestD1Rows: unavailable('aggregate_metrics_cannot_attribute_requests') },
    costs: { setup: null, fixture: null, observer: null, teardown: null }
  };
  const deadline = Date.now() + GUEST_LIMITS.dispatchDeadlineMs;
  let stopped = false, index = 0;
  const learnedCookies = new Set();
  const expected = Object.fromEntries(operations.map(operation => [operation.key, 0]));
  let appAdmissions = 0;
  const remaining = () => Math.max(1, Math.min(GUEST_LIMITS.requestTimeoutMs, deadline - Date.now()));
  try {
    const before = await bounded(() => observations.before(), remaining());
    async function worker(end) {
      while (!stopped && index < end) {
        if (Date.now() >= deadline) { stopped = true; break; }
        const item = workload[index++];
        receipt.attempted++;
        const controller = new AbortController();
        try {
          await bounded(async () => {
            const response = await request(targetOrigin + item.path, { method: item.method, redirect: 'manual', signal: controller.signal, item });
            if (controller.signal.aborted) { try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* best effort */ } throw new Error('GUEST_TIMEOUT'); }
            if (!response || response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== targetOrigin + item.path) denyResponse(response);
            const health = item.path === '/api/health';
            const negative = item.case === 'wrong-origin' || item.case === 'missing-capability';
            const expectedStatus = item.case === 'wrong-origin' ? 403 : item.case === 'missing-capability' ? 401 : 200;
            const directives = cacheDirectives(response.headers.get('cache-control') ?? '');
            if (response.status !== expectedStatus || !directives.has('no-store')) denyResponse(response);
            const limit = health ? 256 : negative || item.path.endsWith('/session') ? 16384 : item.path.endsWith('/courses') ? 524288 : 2097152;
            const payload = await readBody(response, controller.signal, limit);
            const text = JSON.stringify(payload);
            if (sensitiveValues.some(value => typeof value !== 'string' || !value || text.includes(value) || containsSensitive(payload, value)) || [...learnedCookies].some(value => text.includes(value) || containsSensitive(payload, value))) throw new Error('GUEST_RESPONSE_INVALID');
            if (health) {
              if (!payload || Array.isArray(payload) || Object.keys(payload).length !== 1 || payload.status !== 'ok') throw new Error('GUEST_RESPONSE_INVALID');
            } else {
              if ((response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json' || !directives.has('private')) throw new Error('GUEST_RESPONSE_INVALID');
              const schema = negative ? schemas.guestApiErrorSchema : item.path.endsWith('/session') ? schemas.guestSessionResponseSchema : item.path.endsWith('/feed') ? schemas.guestCanvasFeedResponseSchema : item.path.endsWith('/courses') ? schemas.guestEdCoursesResponseSchema : schemas.guestEdLessonsResponseSchema;
              if (!schema?.safeParse(payload).success) throw new Error('GUEST_RESPONSE_INVALID');
              if (negative) {
                if (payload.code !== (item.case === 'wrong-origin' ? 'UNTRUSTED_ORIGIN' : 'GUEST_SESSION_REQUIRED')) throw new Error('GUEST_RESPONSE_INVALID');
              } else {
                if (item.path.endsWith('/session')) {
                  const parts = (response.headers.get('set-cookie') ?? '').split(';').map(value => value.trim());
                  const attributes = parts.slice(1).map(part => part.toLowerCase()).sort();
                  if (!/^__Host-kairos-guest-sync=[^;\s,]+$/.test(parts[0] ?? '') || JSON.stringify(attributes) !== JSON.stringify(['httponly', 'max-age=1800', 'path=/', 'samesite=strict', 'secure'])) throw new Error('GUEST_RESPONSE_INVALID');
                  const value = parts[0].slice(parts[0].indexOf('=') + 1);
                  if (text.includes(value) || containsSensitive(payload, value)) throw new Error('GUEST_RESPONSE_INVALID');
                  learnedCookies.add(value);
                }
                if (payload.requestId !== item.requestId || (item.path.endsWith('/lessons') && payload.courseId !== item.courseId)) throw new Error('GUEST_RESPONSE_INVALID');
                const member = item.path.endsWith('/feed') ? 'assignments' : item.path.endsWith('/courses') ? 'courses' : item.path.endsWith('/lessons') ? 'lessons' : null;
                if (member && (!Number.isSafeInteger(item.expectedCount) || payload[member].length !== item.expectedCount)) throw new Error('GUEST_RESPONSE_INVALID');
              }
            }
            if (controller.signal.aborted) throw new Error('GUEST_TIMEOUT');
            receipt.completed++;
            const key = fixtureKey(item);
            if (key) { expected[key]++; appAdmissions += key === 'challenge' ? 1 : 3; }
          }, remaining(), () => controller.abort());
        } catch { stopped = true; }
      }
    }
    while (!stopped && index < workload.length) {
      const phase = workload[index].phase ?? 0;
      let end = index;
      while (end < workload.length && (workload[end].phase ?? 0) === phase) end++;
      await Promise.all(Array.from({ length: Math.min(GUEST_LIMITS.concurrent, end - index) }, () => worker(end)));
    }
    if (await bounded(() => observations.quiesce(), remaining()) !== true) throw new Error('GUEST_NOT_QUIESCENT');
    const after = await bounded(() => observations.after(), remaining());
    const valid = snapshot => snapshot && snapshot.tables && Number.isSafeInteger(snapshot.identifiedAdmissions) && snapshot.identifiedAdmissions >= 0 && Object.entries(snapshot.tables).every(([name, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && Number.isSafeInteger(value?.count) && value.count >= 0 && /^[a-f0-9]{64}$/.test(value.sha256));
    if (!valid(before) || !valid(after) || after.priorAdmissionsPreserved !== true || !before.tables.abuse_rate_events || !after.tables.abuse_rate_events || after.tables.abuse_rate_events.count - before.tables.abuse_rate_events.count !== appAdmissions || before.identifiedAdmissions !== after.identifiedAdmissions || JSON.stringify(Object.keys(before.tables).sort()) !== JSON.stringify(Object.keys(after.tables).sort()) || Object.keys(before.tables).some(name => name !== 'abuse_rate_events' && JSON.stringify(before.tables[name]) !== JSON.stringify(after.tables[name]))) {
      receipt.code = 'GUEST_OBSERVATION_INVALID';
      return receipt;
    }
    const validFixtureTables = snapshot => snapshot.fixtureTables && Object.keys(snapshot.fixtureTables).length === 1 && snapshot.fixtureTables.fixture_operation?.count === operations.length && /^[a-f0-9]{64}$/.test(snapshot.fixtureTables.fixture_operation?.sha256 ?? '');
    if (!validFixtureTables(before) || !validFixtureTables(after) || operations.some(({ key, cap }) => {
      const first = before.fixture?.[key], last = after.fixture?.[key];
      return !first || !last || first.runId !== verifiedPackage.manifest.inventory.runId || last.runId !== first.runId || first.scenario !== verifiedPackage.manifest.inventory.scenario || last.scenario !== first.scenario || first.cap !== cap || last.cap !== cap || !Number.isSafeInteger(first.calls) || !Number.isSafeInteger(last.calls) || first.calls < 0 || last.calls > cap || last.calls - first.calls !== expected[key];
    }) || Object.keys(before.fixture).length !== operations.length || Object.keys(after.fixture).length !== operations.length) {
      receipt.code = 'GUEST_COUNTERS_INVALID';
      return receipt;
    }
    const cleanTables = snapshot => Object.fromEntries(Object.entries(snapshot.tables).map(([name, value]) => [name, { count: value.count, sha256: value.sha256 }]));
    const cleanFixture = snapshot => Object.fromEntries(operations.map(({ key }) => [key, { calls: snapshot.fixture[key].calls, cap: snapshot.fixture[key].cap }]));
    receipt.observation = { tablesBefore: cleanTables(before), tablesAfter: cleanTables(after), fixtureTablesBefore: { fixture_operation: { count: before.fixtureTables.fixture_operation.count, sha256: before.fixtureTables.fixture_operation.sha256 } }, fixtureTablesAfter: { fixture_operation: { count: after.fixtureTables.fixture_operation.count, sha256: after.fixtureTables.fixture_operation.sha256 } }, fixtureBefore: cleanFixture(before), fixtureAfter: cleanFixture(after), identifiedAdmissionsBefore: before.identifiedAdmissions, identifiedAdmissionsAfter: after.identifiedAdmissions, priorAdmissionsPreserved: true, appAdmissions, fixtureAdmissions: Object.values(expected).reduce((a, b) => a + b, 0) };
  } catch { stopped = true; }
  if (stopped) receipt.code = 'GUEST_DISPATCH_INCOMPLETE';
  else if (workload.length > 0) { receipt.status = 'passed'; receipt.code = 'GUEST_DIAGNOSTIC_VALIDATED'; }
  return receipt;
}
