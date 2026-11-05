import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createNativeRequestAdapter, makeGuestWorkload, orderNativeModules, parseGuestHostedArguments, parseNativeProofArguments, preserveAdmissions, readGuestCookie, tableDigest } from '../../scripts/lib/guest-hosted-native.mjs';
import { prepareHostedDiagnostic } from '../../scripts/lib/guest-hosted-observations.mjs';

const origin = 'https://guest-diagnostic.mykairos.me';
const secrets = { GUEST_OPERATOR_SECRET: 'synthetic-operator', GUEST_FIXTURE_CHALLENGE_TOKEN: 'synthetic-challenge', GUEST_FIXTURE_ED_SMOKE_TOKEN: 'synthetic-smoke', GUEST_FIXTURE_ED_NEAR_TOKEN: 'synthetic-near' };

describe('guest diagnostic operator boundary', () => {
  it('requires explicit native package identity and fresh evidence location without retained defaults', () => {
    const digest = 'a'.repeat(64);
    expect(parseNativeProofArguments(['owned/manifest.json', 'inventory.json', digest, 'owned/proof-new'])).toEqual({ manifestPath: 'owned/manifest.json', inventoryPath: 'inventory.json', expectedDigest: digest, evidenceRoot: 'owned/proof-new' });
    for (const invalid of [[], ['owned/manifest.json', 'inventory.json', digest], ['owned/manifest.json', 'inventory.json', 'invalid', 'owned/proof'], ['owned/manifest.json', 'inventory.json', digest, '--remote']]) expect(() => parseNativeProofArguments(invalid)).toThrow('GUEST_NATIVE_INPUT_REQUIRED');
  });
  it('requires explicit build or verified package inputs and hosted evidence output', () => {
    const digest = 'b'.repeat(64);
    expect(parseGuestHostedArguments(['--prepare', 'build-receipt.json', 'inventory.json', 'owned/package-new'])).toEqual({ mode: 'prepare', buildReceiptPath: 'build-receipt.json', inventoryPath: 'inventory.json', outputRoot: 'owned/package-new' });
    expect(parseGuestHostedArguments(['--verify-prepared', 'owned/manifest.json', 'inventory.json', digest])).toEqual({ mode: 'verify-prepared', manifestPath: 'owned/manifest.json', inventoryPath: 'inventory.json', expectedDigest: digest });
    expect(parseGuestHostedArguments(['--hosted', 'operator-input.json', digest, 'owned/hosted-new'])).toEqual({ mode: 'hosted', operatorInputPath: 'operator-input.json', expectedDigest: digest, evidenceRoot: 'owned/hosted-new' });
    for (const invalid of [[], ['--verify-prepared'], ['--prepare', 'inventory.json', 'owned/package'], ['--hosted', 'operator-input.json', digest]]) expect(() => parseGuestHostedArguments(invalid)).toThrow('GUEST_EXPLICIT_ADAPTER_REQUIRED');
  });
  it('selects the verified config main before lexical data files without duplicating modules', () => {
    const fixture = ['fixture/data.mjs', 'fixture/entry.mjs', 'fixture/request-body.mjs', 'fixture/worker.mjs'];
    expect(orderNativeModules(fixture, './fixture/entry.mjs')).toEqual(['fixture/entry.mjs', 'fixture/data.mjs', 'fixture/request-body.mjs', 'fixture/worker.mjs']);
    expect(fixture[0]).toBe('fixture/data.mjs');
    expect(orderNativeModules(['prelude.mjs', 'app/server/index.js', 'entry.mjs'], './entry.mjs')).toEqual(['entry.mjs', 'app/server/index.js', 'prelude.mjs']);
    for (const [paths, main] of [[fixture, './fixture/missing.mjs'], [[...fixture, fixture[0]], './fixture/entry.mjs'], [fixture, '../fixture/entry.mjs'] ] as [string[], string][]) {
      expect(() => orderNativeModules(paths, main)).toThrow('GUEST_NATIVE_ENTRY_INVALID');
    }
  });
  it('defaults to a fixed refusal and never echoes argument values', () => {
    const result = spawnSync(process.execPath, ['scripts/run-guest-hosted-diagnostic.mjs', '--hosted', 'private-test-value'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('GUEST_EXPLICIT_ADAPTER_REQUIRED');
    expect(result.stdout).toBe('');
  });
  it('refuses native execution before creating a runtime when inputs are absent', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-workerd-guest-hosted-package.mjs'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('GUEST_NATIVE_INPUT_REQUIRED');
    expect(result.stdout).toBe('');
  });

  it('defines the independent 13-attempt baseline and exact near counts', () => {
    const workload = makeGuestWorkload();
    expect(workload).toHaveLength(13);
    expect(workload.filter(item => item.near).map(item => item.expectedCount)).toEqual([2000, 2000, 500, 500, 1000, 1000]);
    expect(new Set(workload.filter(item => item.method === 'POST').map(item => item.requestId)).size).toBe(12);
    expect(workload.map(item => item.phase)).toEqual([0, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4]);
  });

  it('requires all exact host cookie attributes before storing a capability', () => {
    const good = '__Host-kairos-guest-sync=synthetic-capability; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800';
    expect(readGuestCookie(good)).toBe('__Host-kairos-guest-sync=synthetic-capability');
    for (const invalid of [null, good + '; Domain=mykairos.me', good.replace('Secure; ', ''), good.replace('Strict', 'Lax'), good.replace('1800', '3600'), good + '; Secure']) {
      expect(() => readGuestCookie(invalid)).toThrow('GUEST_COOKIE_INVALID');
    }
  });

  it('uses the supplied URL and ordinary origin without rewriting transport headers', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    const sensitiveValues = Object.values(secrets);
    const adapter = createNativeRequestAdapter({ origin, secrets, sensitiveValues, fetch: async (url: string, init: RequestInit) => {
      captured.push({ url, init });
      return new Response('{}', { headers: { 'set-cookie': '__Host-kairos-guest-sync=synthetic-capability; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800' } });
    } });
    const workload = makeGuestWorkload();
    const signal = new AbortController().signal;
    await (await adapter.request(origin + workload[1].path, { method: 'POST', redirect: 'manual', signal, item: workload[1] })).text();
    await (await adapter.request(origin + workload[2].path, { method: 'POST', redirect: 'manual', signal, item: workload[2] })).text();
    const headers = new Headers(captured[1].init.headers);
    expect(captured[1].url).toBe(origin + workload[2].path);
    expect(headers.get('origin')).toBe(origin);
    expect(headers.get('host')).toBeNull();
    expect(headers.get('x-forwarded-host')).toBeNull();
    expect(headers.get('cookie')).toBe('__Host-kairos-guest-sync=synthetic-capability');
    expect(sensitiveValues).toContain('synthetic-capability');
    expect(captured[1].init.redirect).toBe('manual');
    expect(await adapter.quiesce()).toBe(true);
    await expect(adapter.request('https://escape.invalid/api/health', { method: 'GET', redirect: 'manual', signal, item: workload[0] })).rejects.toThrow('GUEST_NATIVE_TARGET_INVALID');
    expect(captured).toHaveLength(2);
  });

  it('does not declare quiescence with an unfinished response body', async () => {
    const adapter = createNativeRequestAdapter({ origin, secrets, sensitiveValues: Object.values(secrets), fetch: async () => new Response(new ReadableStream({ start() {} })) });
    const item = makeGuestWorkload()[0];
    const response = await adapter.request(origin + item.path, { method: 'GET', redirect: 'manual', signal: new AbortController().signal, item });
    expect(await adapter.quiesce(5)).toBe(false);
    await response.body?.cancel();
    expect(await adapter.quiesce()).toBe(true);
  });

  it('checks row preservation with multiplicity and permits only new null-user admissions', () => {
    const old = [{ id: 'old', user_id: null }, { id: 'old', user_id: null }];
    expect(preserveAdmissions(old, [...old, { id: 'new', user_id: null }])).toBe(true);
    expect(preserveAdmissions(old, [{ id: 'old', user_id: null }, { id: 'new', user_id: null }])).toBe(false);
    expect(preserveAdmissions(old, [...old, { id: 'new', user_id: 'identified' }])).toBe(false);
    expect(tableDigest(old)).toEqual(tableDigest([...old].reverse()));
    expect(tableDigest(old)).not.toEqual(tableDigest(old.slice(1)));
  });
});

describe('hosted operator preflight with injected read-only fakes', () => {
  const tableNames = ['abuse_controls', 'abuse_rate_events', 'accounts', 'app_settings', 'assignment_links', 'assignment_submission_status', 'assignments', 'calendar_connections', 'calendar_credentials', 'calendar_event_links', 'oauth_requests', 'operation_locks', 'sessions', 'source_connections', 'source_courses', 'source_credentials', 'submission_status_sync', 'sync_all_runs', 'sync_all_steps', 'sync_requests', 'users', 'verification_tokens'];
  const inventory = { version: 1, runId: 'h2-hosted-unit', scenario: 'bounded-v1', hostname: 'guest-diagnostic.mykairos.me', candidateName: 'kairos-guest-app-h2-hosted-unit', fixtureName: 'kairos-guest-fixture-h2-hosted-unit', appDatabaseName: 'kairos-guest-app-h2-hosted-unit', fixtureDatabaseName: 'kairos-guest-fixture-h2-hosted-unit', accountId: '0123456789abcdef0123456789abcdef', appDatabaseId: '12345678-1234-1234-1234-123456789abc', fixtureDatabaseId: '87654321-4321-4321-4321-cba987654321' };
  const expectedDigest = 'b'.repeat(64);
  const input = () => ({ schemaVersion: 1, manifestPath: 'artifacts/guest-hosted/package-h2-hosted-unit/manifest.json', inventory, authorization: { approved: true, action: 'guest-diagnostic-read-only-run', packageDigest: expectedDigest, runId: inventory.runId, hostname: inventory.hostname } });
  const credentials = { apiReadToken: 'private-read-token', secrets: { ...secrets, KAIROS_ABUSE_KEY_V1: 'private-hmac', KAIROS_TURNSTILE_SITE_KEY: 'private-sitekey', KAIROS_TURNSTILE_SECRET_KEY: 'private-challenge-key' } };
  const verifyPackage = async (options: { manifestPath: string; mode?: string }) => ({ manifestPath: options.manifestPath, packageDigest: expectedDigest, mode: options.mode ?? 'offline', manifest: { inventory } });

  it('rejects missing authorization, unresolved identity, digest drift and unknown fields before any API request', async () => {
    let calls = 0;
    const fetch = async () => { calls++; return new Response('{}'); };
    for (const bad of [ { ...input(), authorization: undefined }, { ...input(), inventory: { ...inventory, accountId: null } }, { ...input(), extra: true } ]) {
      await expect(prepareHostedDiagnostic({ input: bad, expectedDigest, credentials, fetch, verifyPackage })).rejects.toThrow('GUEST_HOSTED_PREFLIGHT_FAILED');
    }
    await expect(prepareHostedDiagnostic({ input: input(), expectedDigest: 'c'.repeat(64), credentials, fetch, verifyPackage })).rejects.toThrow('GUEST_HOSTED_PREFLIGHT_FAILED');
    expect(calls).toBe(0);
  });

  it('matches database metadata before reading any rows and sanitizes mismatches', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetch = async (url: string, init: RequestInit) => { calls.push({ url, method: init.method ?? 'GET' }); return Response.json({ success: true, result: { uuid: inventory.appDatabaseId, name: 'private-wrong-database-name' } }); };
    const prepared = await prepareHostedDiagnostic({ input: input(), expectedDigest, credentials, fetch, verifyPackage });
    await expect(prepared.observations.before()).rejects.toThrow('GUEST_HOSTED_OBSERVATION_FAILED');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/' + inventory.accountId + '/d1/database/' + inventory.appDatabaseId);
  });

  it('uses ordinary HTTPS headers for application requests and records hosted mode', async () => {
    let headers = new Headers();
    const queries: string[] = [];
    const prepared = await prepareHostedDiagnostic({ input: input(), expectedDigest, credentials, verifyPackage, fetch: async (url: string, init: RequestInit) => {
      if (!url.startsWith('https://api.cloudflare.com/')) { headers = new Headers(init.headers); return new Response('{"status":"ok"}'); }
      const fixture = url.includes(inventory.fixtureDatabaseId);
      if (init.method === 'GET') return Response.json({ success: true, result: { uuid: fixture ? inventory.fixtureDatabaseId : inventory.appDatabaseId, name: fixture ? inventory.fixtureDatabaseName : inventory.appDatabaseName } });
      const sql = JSON.parse(String(init.body)).sql as string;
      queries.push(sql);
      const rows = sql.includes('sqlite_master') ? (fixture ? ['fixture_operation'] : tableNames).map(name => ({ name })) : fixture ? ['challenge', 'canvas-smoke', 'canvas-near', 'ed-courses-smoke', 'ed-courses-near', 'ed-lessons-smoke', 'ed-lessons-near'].map(operation => ({ operation, run_id: inventory.runId, scenario: inventory.scenario, call_cap: operation.startsWith('canvas-') ? 8 : 16, calls: 0 })) : [];
      return Response.json({ success: true, result: [{ success: true, results: rows, meta: { rows_read: rows.length, rows_written: 0 } }] });
    } });
    await prepared.observations.before();
    const item = makeGuestWorkload()[0];
    await (await prepared.request(origin + item.path, { method: 'GET', redirect: 'manual', signal: new AbortController().signal, item })).text();
    expect(headers.get('origin')).toBe(origin);
    expect(headers.has('host')).toBe(false);
    expect(headers.has('cf-connecting-ip')).toBe(false);
    expect(headers.has('x-forwarded-for')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
    expect(prepared.executionMode).toBe('hosted');
    expect(queries).toHaveLength(25);
    expect(queries.every(query => query.startsWith('SELECT ') && !/[;]|UPDATE|INSERT|DELETE|DROP|PRAGMA/.test(query))).toBe(true);
    expect(prepared.observerCosts.queryRequests).toBe(25);
  });

  it('blocks application traffic until a complete verified before-snapshot exists', async () => {
    let calls = 0;
    const prepared = await prepareHostedDiagnostic({ input: input(), expectedDigest, credentials, verifyPackage, fetch: async () => { calls++; throw new Error('private-api-error'); } });
    const item = makeGuestWorkload()[0];
    const init = { method: 'GET', redirect: 'manual' as const, signal: new AbortController().signal, item };
    await expect(prepared.request(origin + item.path, init)).rejects.toThrow('GUEST_HOSTED_PREFLIGHT_FAILED');
    expect(calls).toBe(0);
    await expect(prepared.observations.before()).rejects.toThrow('GUEST_HOSTED_OBSERVATION_FAILED');
    await expect(prepared.request(origin + item.path, init)).rejects.toThrow('GUEST_HOSTED_PREFLIGHT_FAILED');
    expect(calls).toBe(1);
  });

  it('rejects extra tables, partial row inventories and unexpected D1 writes', async () => {
    for (const scenario of ['extra-table', 'truncated-rows', 'write-metadata']) {
      let queries = 0;
      const prepared = await prepareHostedDiagnostic({ input: input(), expectedDigest, credentials, verifyPackage, fetch: async (url: string, init: RequestInit) => {
        const fixture = url.includes(inventory.fixtureDatabaseId);
        if (init.method === 'GET') return Response.json({ success: true, result: { uuid: fixture ? inventory.fixtureDatabaseId : inventory.appDatabaseId, name: fixture ? inventory.fixtureDatabaseName : inventory.appDatabaseName } });
        queries++;
        const sql = JSON.parse(String(init.body)).sql as string;
        const results = sql.includes('sqlite_master') ? [...tableNames, ...(scenario === 'extra-table' ? ['private-extra-table'] : [])].map(name => ({ name })) : Array.from({ length: 2049 }, () => ({ private_row: 'never-logged' }));
        return Response.json({ success: true, result: [{ success: true, results, meta: { rows_read: results.length, rows_written: scenario === 'write-metadata' ? 1 : 0 } }] });
      } });
      await expect(prepared.observations.before()).rejects.toThrow('GUEST_HOSTED_OBSERVATION_FAILED');
      expect(queries).toBeLessThanOrEqual(2);
    }
  });

  it('bounds an API response read even if its stream and cancellation never settle', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const prepared = await prepareHostedDiagnostic({ input: input(), expectedDigest, credentials, verifyPackage, fetch: async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }), { headers: { 'content-type': 'application/json' } }) });
      const pending = expect(prepared.observations.before()).rejects.toThrow('GUEST_HOSTED_OBSERVATION_FAILED');
      await vi.advanceTimersByTimeAsync(10001);
      await pending;
      expect(prepared.observerCosts.queryRequests).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
