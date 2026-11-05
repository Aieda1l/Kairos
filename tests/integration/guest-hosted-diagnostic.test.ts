import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildGuestHostedApplication } from '../../scripts/lib/guest-hosted-build.mjs';
import { prepareGuestHostedPackage, verifyGuestHostedPackage } from '../../scripts/lib/guest-hosted-package.mjs';
import { loadGuestHostedSchemas, runGuestHostedDiagnostic } from '../../scripts/lib/guest-hosted-diagnostic.mjs';

const origin = 'https://guest-diagnostic.mykairos.me';
const verifiedPackage = { packageDigest: 'a'.repeat(64), mode: 'offline', manifest: { inventory: { hostname: 'guest-diagnostic.mykairos.me', runId: 'h2-schema-test', scenario: 'bounded-v1' } } };
let fixturePackage: Awaited<ReturnType<typeof verifyGuestHostedPackage>>;
beforeAll(async () => {
  const root = resolve('artifacts/guest-hosted');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'h2-schema-test-'));
  const inventory = { version: 1, runId: 'h2-schema-test', scenario: 'bounded-v1', hostname: 'guest-diagnostic.mykairos.me', candidateName: 'kairos-guest-app-h2-schema-test', fixtureName: 'kairos-guest-fixture-h2-schema-test', appDatabaseName: 'kairos-guest-app-h2-schema-test', fixtureDatabaseName: 'kairos-guest-fixture-h2-schema-test', accountId: null, appDatabaseId: null, fixtureDatabaseId: null };
  const receipt = await buildGuestHostedApplication({ applicationRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), outputRoot: join(directory, 'build') });
  const prepared = await prepareGuestHostedPackage({ buildReceipt: receipt, inventory, outputRoot: join(directory, 'package') });
  fixturePackage = await verifyGuestHostedPackage({ ...prepared, inventory, mode: 'offline' });
}, 120000);
const snapshot = () => ({ tables: { protected: { count: 0, sha256: '0'.repeat(64) }, abuse_rate_events: { count: 0, sha256: '0'.repeat(64) } }, fixtureTables: { fixture_operation: { count: 7, sha256: '0'.repeat(64) } }, identifiedAdmissions: 0, priorAdmissionsPreserved: true, fixture: Object.fromEntries(['challenge', 'canvas-smoke', 'canvas-near', 'ed-courses-smoke', 'ed-lessons-smoke', 'ed-courses-near', 'ed-lessons-near'].map(key => [key, { runId: 'h2-schema-test', scenario: 'bounded-v1', cap: key.startsWith('canvas-') ? 8 : 16, calls: 0 }])) });
const observations = { before: snapshot, quiesce: () => true, after: snapshot };
const run = (extra: Record<string, unknown> = {}) => runGuestHostedDiagnostic({ verifiedPackage: fixturePackage as never, targetOrigin: origin, workload: [], request: async () => new Response('{}'), observations, ...extra });

it('requires an explicit verified package for schema loading', async () => {
  // @ts-expect-error Exercise missing required input at runtime.
  const failure = await loadGuestHostedSchemas().then(() => null, error => error.message);
  expect(failure).toBe('GUEST_SCHEMA_SOURCE_INVALID');
  const nullFailure = await loadGuestHostedSchemas(null as never).then(() => null, error => error.message);
  expect(nullFailure).toBe('GUEST_SCHEMA_SOURCE_INVALID');
});
it('rejects a mismatched verified package identity', async () => {
  const failure = await loadGuestHostedSchemas({ verifiedPackage: { ...fixturePackage, packageDigest: 'f'.repeat(64) } }).then(() => null, error => error.message);
  expect(failure).toBe('GUEST_SCHEMA_SOURCE_INVALID');
  const absent = await loadGuestHostedSchemas({ verifiedPackage: { ...fixturePackage, manifestPath: join(resolve('artifacts/guest-hosted'), 'missing', 'manifest.json') } }).then(() => null, error => error.message);
  expect(absent).toBe('GUEST_SCHEMA_SOURCE_INVALID');
});

describe('bounded guest diagnostic', () => {
  it('accepts a completely validated health response and stable observations', async () => {
    const result = await run({ workload: [{ method: 'GET', path: '/api/health' }], request: () => new Response('{"status":"ok"}', { headers: { 'cache-control': 'no-store' } }) });
    expect(result.status).toBe('passed');
    expect(result.completed).toBe(1);
  });
  it('rejects health payloads with unexpected fields', async () => {
    const result = await run({ workload: [{ method: 'GET', path: '/api/health' }], request: () => new Response('{"status":"ok","extra":true}', { headers: { 'cache-control': 'no-store' } }) });
    expect(result.code).toBe('GUEST_DISPATCH_INCOMPLETE');
  });
  it('requires explicit adapters and exact origin', async () => {
    await expect(run({ request: undefined })).rejects.toThrow('GUEST_ADAPTER_REQUIRED');
    await expect(run({ targetOrigin: 'https://other.example' })).rejects.toThrow('GUEST_TARGET_INVALID');
    await expect(run({ verifiedPackage: { ...verifiedPackage, mode: 'operator-ready' } })).rejects.toThrow('GUEST_PACKAGE_INVALID');
  });
  it('rejects an oversized workload before dispatch', async () => {
    let sent = 0;
    await expect(run({ workload: Array.from({ length: 65 }, () => ({ method: 'GET', path: '/api/health' })), request: () => { sent++; return new Response('{}'); } })).rejects.toThrow('GUEST_WORKLOAD_INVALID');
    expect(sent).toBe(0);
  });
  it('rejects redirects without exposing error details', async () => {
    const result = await run({ workload: [{ method: 'GET', path: '/api/health' }], request: () => new Response(null, { status: 302, headers: { location: 'https://secret.example' } }) });
    expect(result.status).toBe('incomplete');
    expect(JSON.stringify(result)).not.toContain('secret.example');
  });
  it('does not accept a changed protected table', async () => {
    const result = await run({ observations: { ...observations, after: () => ({ ...snapshot(), tables: { ...snapshot().tables, protected: { count: 1, sha256: '1'.repeat(64) } } }) } });
    expect(result.status).toBe('incomplete');
    expect(result.code).toBe('GUEST_OBSERVATION_INVALID');
  });
  it('rejects unexplained durable fixture admissions', async () => {
    const result = await run({ observations: { ...observations, after: () => ({ ...snapshot(), fixture: { ...snapshot().fixture, challenge: { ...snapshot().fixture.challenge, calls: 1 } } }) } });
    expect(result.code).toBe('GUEST_COUNTERS_INVALID');
  });
  it('rejects loss of previously admitted rows even when counts match', async () => {
    const result = await run({ observations: { ...observations, after: () => ({ ...snapshot(), priorAdmissionsPreserved: false }) } });
    expect(result.code).toBe('GUEST_OBSERVATION_INVALID');
  });
  it('rejects fixture configuration drift', async () => {
    const after = snapshot();
    after.fixture.challenge.cap = 15;
    const result = await run({ observations: { ...observations, after: () => after } });
    expect(result.code).toBe('GUEST_COUNTERS_INVALID');
  });
  it('caps concurrency across the phase', async () => {
    let active = 0, peak = 0;
    const result = await run({ workload: Array.from({ length: 12 }, () => ({ method: 'GET', path: '/api/health' })), request: async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return new Response('{"status":"ok"}', { headers: { 'cache-control': 'no-store' } }); } });
    expect(result.status).toBe('passed');
    expect(result.attempted).toBe(12);
    expect(peak).toBe(6);
  });
  it('counts failed attempts and stops further dispatch without exposing errors', async () => {
    const result = await run({ workload: Array.from({ length: 64 }, () => ({ method: 'GET', path: '/api/health' })), request: async () => { throw new Error('private-synthetic-secret'); } });
    expect(result.status).toBe('incomplete');
    expect(result.attempted).toBeGreaterThan(0);
    expect(result.attempted).toBeLessThanOrEqual(6);
    expect(result.completed).toBe(0);
    expect(JSON.stringify(result)).not.toContain('private-synthetic-secret');
  });
  it('rejects fixture cap exhaustion before dispatch', async () => {
    const { schemas } = await loadGuestHostedSchemas({ verifiedPackage: fixturePackage });
    let sent = 0;
    await expect(run({ schemas, workload: Array.from({ length: 9 }, () => ({ method: 'POST', path: '/api/guest/sources/canvas/feed', expectedCount: 1 })), request: () => { sent++; return new Response(); } })).rejects.toThrow('GUEST_WORKLOAD_INVALID');
    expect(sent).toBe(0);
  });
});

it('validates a complete session with the frozen application schema', async () => {
  const { schemas, provenance } = await loadGuestHostedSchemas({ verifiedPackage: fixturePackage });
  const requestId = '00000000-0000-4000-8000-000000000002';
  const after = snapshot();
  after.fixture.challenge.calls = 1;
  after.tables.abuse_rate_events.count = 1;
  const result = await run({ schemas, workload: [{ method: 'POST', path: '/api/guest/session', requestId }], observations: { ...observations, after: () => after }, request: () => Response.json({ ok: true, schemaVersion: 1, requestId, checkedAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-04T00:30:00.000Z' }, { headers: { 'cache-control': 'no-store, private', 'set-cookie': '__Host-kairos-guest-sync=synthetic; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800' } }) });
  expect(provenance.externalImports).toBe(0);
  expect(provenance.applicationRevision).toBe(fixturePackage.manifest.applicationRevision);
  expect(provenance.buildReceiptSha256).toBe(fixturePackage.manifest.buildReceiptSha256);
  expect(result.status).toBe('passed');
  await expect(run({ schemas, verifiedPackage: { ...fixturePackage, packageDigest: 'f'.repeat(64) }, workload: [{ method: 'POST', path: '/api/guest/session', requestId }] })).rejects.toThrow('GUEST_SCHEMA_REQUIRED');
  const invalid = await run({ schemas, workload: [{ method: 'POST', path: '/api/guest/session', requestId }], observations: { ...observations, after: () => after }, request: () => Response.json({ ok: true, schemaVersion: 1, requestId, checkedAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-04T00:30:00.000Z', extra: 1 }, { headers: { 'cache-control': 'no-store, private', 'set-cookie': '__Host-kairos-guest-sync=synthetic; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800' } }) });
  expect(invalid.status).toBe('incomplete');
});

it('bounds a body read that ignores abort and does not expose adapter errors', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    const pending = run({ workload: [{ method: 'GET', path: '/api/health' }], request: () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }), { headers: { 'cache-control': 'no-store' } }) });
    await vi.advanceTimersByTimeAsync(21000);
    const result = await pending;
    expect(result.status).toBe('incomplete');
    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('releases a stalled reader even when read and cancel never settle', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  let released = false;
  try {
    const response = { status: 200, redirected: false, url: '', headers: new Headers({ 'cache-control': 'no-store' }), body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: () => new Promise(() => {}), releaseLock: () => { released = true; } }) } } as unknown as Response;
    const pending = run({ workload: [{ method: 'GET', path: '/api/health' }], request: () => response });
    await vi.advanceTimersByTimeAsync(21000);
    expect((await pending).status).toBe('incomplete');
    expect(released).toBe(true);
  } finally { vi.useRealTimers(); }
});

it('requires real cache directives and JSON media type tokens', async () => {
  const { schemas } = await loadGuestHostedSchemas({ verifiedPackage: fixturePackage });
  const requestId = '00000000-0000-4000-8000-000000000002';
  const after = snapshot(); after.fixture.challenge.calls = 1; after.tables.abuse_rate_events.count = 1;
  const check = (cache: string, contentType: string) => run({ schemas, workload: [{ method: 'POST', path: '/api/guest/session', requestId }], observations: { ...observations, after: () => after }, request: () => new Response(JSON.stringify({ ok: true, schemaVersion: 1, requestId, checkedAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-04T00:30:00.000Z' }), { headers: { 'cache-control': cache, 'content-type': contentType, 'set-cookie': '__Host-kairos-guest-sync=synthetic; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800' } }) });
  for (const [cache, mime] of [['x-no-store, x-private', 'application/json'], ['other="no-store, private"', 'application/json'], ['other="x\\\", no-store, private"', 'application/json'], ['no-store, private', 'text/plain; note=application/json'], ['no-store, private', 'application/jsonp']]) expect((await check(cache, mime)).status).toBe('incomplete');
  expect((await check(' No-Store , PRIVATE ', 'Application/JSON; charset=utf-8')).status).toBe('passed');
  expect((await check('no-store, other="foo,private", private', 'application/json; charset=utf-8')).status).toBe('passed');
  const health = await run({ workload: [{ method: 'GET', path: '/api/health' }], request: () => new Response('{"status":"ok"}', { headers: { 'cache-control': 'other="no-store, x"' } }) });
  expect(health.status).toBe('incomplete');
});

it('rejects a learned cookie echoed in a later valid source response', async () => {
  const { schemas } = await loadGuestHostedSchemas({ verifiedPackage: fixturePackage });
  const requestId = '00000000-0000-4000-8000-000000000002';
  const capability = 'synthetic' + String.fromCharCode(34) + 'CapabilityValue';
  const after = snapshot(); after.fixture.challenge.calls = 1; after.fixture['ed-courses-smoke'].calls = 1; after.tables.abuse_rate_events.count = 4;
  const check = (fullName: string, sensitiveValues?: string[]) => run({ schemas, sensitiveValues, workload: [{ method: 'POST', path: '/api/guest/session', requestId, phase: 0 }, { method: 'POST', path: '/api/guest/sources/ed/courses', requestId, expectedCount: 1, phase: 1 }], observations: { ...observations, after: () => after }, request: (_url: string, options: { item: { path: string } }) => options.item.path.endsWith('/session') ? Response.json({ ok: true, schemaVersion: 1, requestId, checkedAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-04T00:30:00.000Z' }, { headers: { 'cache-control': 'no-store, private', 'set-cookie': `__Host-kairos-guest-sync=${capability}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800` } }) : Response.json({ ok: true, schemaVersion: 1, requestId, checkedAt: '2026-11-04T00:00:00.000Z', courses: [{ externalCourseId: '12', shortName: null, fullName, term: null, year: null }] }, { headers: { 'cache-control': 'no-store, private' } }) });
  expect((await check('Ordinary course')).status).toBe('passed');
  const rejected = await check(capability);
  expect(rejected.status).toBe('incomplete');
  expect(rejected.completed).toBe(1);
  expect(JSON.stringify(rejected)).not.toContain(capability);
  expect((await check(capability, ['syntheticProviderSecret'])).status).toBe('incomplete');
  expect((await check('syntheticProviderSecret', ['syntheticProviderSecret'])).status).toBe('incomplete');
});

it('rejects installed Zod version drift before bundling', async () => {
  const { vi } = await import('vitest');
  let builds = 0;
  vi.resetModules();
  vi.doMock('node:fs/promises', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return { ...original, readFile: async (...args: Parameters<typeof original.readFile>) => {
      if (String(args[0]).replaceAll('\\', '/').endsWith('/node_modules/zod/package.json')) return Buffer.from('{"version":"0.0.0"}');
      return original.readFile(...args);
    } };
  });
  vi.doMock('esbuild', async importOriginal => { const original = await importOriginal<typeof import('esbuild')>(); return { ...original, build: (...args: Parameters<typeof original.build>) => { builds++; return original.build(...args); } }; });
  try {
    const fresh = await import('../../scripts/lib/guest-hosted-diagnostic.mjs');
    const failure = await fresh.loadGuestHostedSchemas({ verifiedPackage: fixturePackage }).then(() => null, error => error.message);
    expect(failure).toBe('GUEST_SCHEMA_SOURCE_INVALID');
    expect(builds).toBe(0);
  } finally { vi.doUnmock('node:fs/promises'); vi.doUnmock('esbuild'); vi.resetModules(); }
});
