// Future authorized hosted execution only. Tests use injected fakes; no setup/mutation API.
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Agent, fetch as tlsFetch } from 'undici';
import { CANDIDATE_SECRET_NAMES, validateGuestHostedInventory, verifyGuestHostedPackage } from './guest-hosted-package.mjs';
import { canonical, sha256 } from './guest-hosted-build.mjs';
import { createNativeRequestAdapter, preserveAdmissions, tableDigest } from './guest-hosted-native.mjs';

const APP_TABLES = Object.freeze(['abuse_controls', 'abuse_rate_events', 'accounts', 'app_settings', 'assignment_links', 'assignment_submission_status', 'assignments', 'calendar_connections', 'calendar_credentials', 'calendar_event_links', 'oauth_requests', 'operation_locks', 'sessions', 'source_connections', 'source_courses', 'source_credentials', 'submission_status_sync', 'sync_all_runs', 'sync_all_steps', 'sync_requests', 'users', 'verification_tokens']);
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
const isCount = value => Number.isSafeInteger(value) && value >= 0;

async function boundedJson(fetch, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer, reader;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('GUEST_HOSTED_OBSERVATION_FAILED')); }, timeoutMs); });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
      if (!response || response.status !== 200 || response.redirected || response.url && response.url !== url || !/application\/json/i.test(response.headers.get('content-type') ?? '')) fail('GUEST_HOSTED_OBSERVATION_FAILED');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8388608)) fail('GUEST_HOSTED_OBSERVATION_FAILED');
      reader = response.body?.getReader();
      if (!reader) fail('GUEST_HOSTED_OBSERVATION_FAILED');
      const chunks = []; let bytes = 0;
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 8388608) fail('GUEST_HOSTED_OBSERVATION_FAILED'); chunks.push(part.value); }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      return { payload: JSON.parse(chunks.map((chunk, index) => decoder.decode(chunk, { stream: index !== chunks.length - 1 })).join('')), bytes };
    })()]);
  } catch { fail('GUEST_HOSTED_OBSERVATION_FAILED'); }
  finally {
    clearTimeout(timer);
    try { void reader?.cancel().catch(() => {}); } catch { /* bounded best effort */ }
    try { reader?.releaseLock(); } catch { /* pending read */ }
  }
}

export async function prepareHostedDiagnostic({ input, expectedDigest, credentials, fetch: injectedFetch, verifyPackage = verifyGuestHostedPackage }) {
  let inventory, verifiedPackage, observerInputs;
  try {
    if (!exact(input, ['schemaVersion', 'manifestPath', 'inventory', 'authorization']) || input.schemaVersion !== 1 || typeof input.manifestPath !== 'string' || input.manifestPath.split(/[\\/]/).at(-1) !== 'manifest.json' || !/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) fail();
    inventory = validateGuestHostedInventory(input.inventory, 'operator-ready');
    const approval = input.authorization;
    if (!exact(approval, ['approved', 'action', 'packageDigest', 'runId', 'hostname']) || approval.approved !== true || approval.action !== 'guest-diagnostic-read-only-run' || approval.packageDigest !== expectedDigest || approval.runId !== inventory.runId || approval.hostname !== inventory.hostname) fail();
    if (!exact(credentials, ['apiReadToken', 'secrets']) || typeof credentials.apiReadToken !== 'string' || !credentials.apiReadToken || credentials.apiReadToken.length > 4096 || /[\r\n]/.test(credentials.apiReadToken) || !exact(credentials.secrets, CANDIDATE_SECRET_NAMES) || CANDIDATE_SECRET_NAMES.some(name => typeof credentials.secrets[name] !== 'string' || !credentials.secrets[name] || credentials.secrets[name].length > 4096 || /[\r\n]/.test(credentials.secrets[name]))) fail();
    const encodedKey = credentials.secrets.KAIROS_ABUSE_KEY_V1;
    if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) fail();
    const decodedKey = Buffer.from(encodedKey, 'base64url');
    if (decodedKey.length !== 32 || decodedKey.toString('base64url') !== encodedKey) fail();
    const manifestPath = resolve(input.manifestPath);
    const ready = await verifyPackage({ manifestPath, inventory, mode: 'operator-ready' });
    if (ready.packageDigest !== expectedDigest) fail();
    verifiedPackage = await verifyPackage({ manifestPath, inventory, mode: 'offline' });
    if (verifiedPackage.packageDigest !== expectedDigest || canonical(verifiedPackage.manifest.inventory) !== canonical(ready.manifest.inventory)) fail();
    observerInputs = await Promise.all([
      ['scripts/lib/guest-hosted-observations.mjs', new URL(import.meta.url)],
      ['scripts/lib/guest-hosted-native.mjs', new URL('./guest-hosted-native.mjs', import.meta.url)],
    ].map(async ([path, url]) => ({ path, sha256: sha256(await readFile(url)) })));
  } catch { fail('GUEST_HOSTED_PREFLIGHT_FAILED'); }
  // No network occurs before every local authorization/identity/digest check above.
  const tlsAgent = injectedFetch ? null : new Agent({ connect: { rejectUnauthorized: true } });
  const fetch = injectedFetch ?? ((url, init) => tlsFetch(url, { ...init, dispatcher: tlsAgent }));
  const sensitiveValues = [credentials.apiReadToken, ...Object.values(credentials.secrets)];
  const targetOrigin = 'https://' + inventory.hostname;
  const adapter = createNativeRequestAdapter({ origin: targetOrigin, secrets: credentials.secrets, sensitiveValues, fetch, syntheticClientAddress: false });
  const headers = { authorization: 'Bearer ' + credentials.apiReadToken, 'content-type': 'application/json' };
  const costs = { metadataRequests: 0, queryRequests: 0, rowsRead: 0, rowsWritten: 0, appD1: { rowsRead: 0, rowsWritten: 0 }, fixtureD1: { rowsRead: 0, rowsWritten: 0 }, exactPerApplicationRequest: null, platformBilling: null };
  let apiCalls = 0, apiBytes = 0, snapshots = 0, snapshotEnd = 0, identityVerified = false, beforeComplete = false, observationFailed = false, previousAdmissions;
  const deadline = Date.now() + 300000;
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + inventory.accountId + '/d1/database/';
  const api = async (databaseId, query) => {
    if (observationFailed || ++apiCalls > 52 || Date.now() >= deadline || Date.now() >= snapshotEnd) fail('GUEST_HOSTED_OBSERVATION_FAILED');
    const url = base + databaseId + (query ? '/query' : '');
    const read = await boundedJson(fetch, url, { method: query ? 'POST' : 'GET', headers, ...(query ? { body: JSON.stringify({ sql: query, params: [] }) } : {}) }, Math.max(1, Math.min(10000, snapshotEnd - Date.now(), deadline - Date.now())));
    apiBytes += read.bytes;
    if (apiBytes > 33554432) fail('GUEST_HOSTED_OBSERVATION_FAILED');
    const response = read.payload;
    if (response.success !== true || response.errors?.length) fail('GUEST_HOSTED_OBSERVATION_FAILED');
    return response.result;
  };
  const identify = async () => {
    if (identityVerified) return;
    for (const [id, name] of [[inventory.appDatabaseId, inventory.appDatabaseName], [inventory.fixtureDatabaseId, inventory.fixtureDatabaseName]]) {
      const metadata = await api(id);
      costs.metadataRequests++;
      if (!metadata || metadata.uuid !== id || metadata.name !== name || metadata.account_id !== undefined && metadata.account_id !== inventory.accountId) fail('GUEST_HOSTED_OBSERVATION_FAILED');
    }
    identityVerified = true;
  };
  const query = async (databaseId, statement) => {
    const results = await api(databaseId, statement);
    if (!Array.isArray(results) || results.length !== 1 || results[0].success !== true || !Array.isArray(results[0].results) || results[0].results.length > 2048 || !isCount(results[0].meta?.rows_read) || results[0].meta.rows_written !== 0) fail('GUEST_HOSTED_OBSERVATION_FAILED');
    costs.queryRequests++; costs.rowsRead += results[0].meta.rows_read;
    costs[databaseId === inventory.appDatabaseId ? 'appD1' : 'fixtureD1'].rowsRead += results[0].meta.rows_read;
    return results[0].results;
  };
  const snapshot = async () => {
    try {
      if (observationFailed || ++snapshots > 2 || !await adapter.quiesce()) fail();
      snapshotEnd = Date.now() + 18000;
      await identify();
      let rows = 0;
      const readTables = async (id, expected) => {
        const names = await query(id, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name <> '_cf_METADATA' AND name <> '_cf_KV' ORDER BY name LIMIT 65");
        if (!names.every(row => exact(row, ['name'])) || canonical(names.map(row => row.name)) !== canonical(expected)) fail();
        const tables = {};
        for (const name of expected) {
          tables[name] = await query(id, 'SELECT * FROM "' + name + '" LIMIT 2049');
          rows += tables[name].length;
          if (rows > 8192) fail();
        }
        return tables;
      };
      const app = await readTables(inventory.appDatabaseId, APP_TABLES), fixture = await readTables(inventory.fixtureDatabaseId, ['fixture_operation']);
      const admissions = app.abuse_rate_events;
      const preserved = previousAdmissions ? preserveAdmissions(previousAdmissions, admissions) : true;
      if (!previousAdmissions) previousAdmissions = admissions;
      if (fixture.fixture_operation.length !== 7 || fixture.fixture_operation.some(row => !exact(row, ['run_id', 'scenario', 'operation', 'call_cap', 'calls']))) fail();
      if (snapshots === 1) beforeComplete = true;
      return { tables: Object.fromEntries(Object.entries(app).map(([name, rows]) => [name, tableDigest(rows)])), identifiedAdmissions: admissions.filter(row => row.user_id !== null).length, priorAdmissionsPreserved: preserved, fixtureTables: { fixture_operation: tableDigest(fixture.fixture_operation) }, fixture: Object.fromEntries(fixture.fixture_operation.map(row => [row.operation, { runId: row.run_id, scenario: row.scenario, cap: row.call_cap, calls: row.calls }])) };
    } catch { observationFailed = true; fail('GUEST_HOSTED_OBSERVATION_FAILED'); }
  };
  const dispose = async () => {
    if (!tlsAgent) return;
    let timer;
    try { await Promise.race([tlsAgent.destroy(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GUEST_HOSTED_CLEANUP_FAILED')), 10000); })]); }
    finally { clearTimeout(timer); }
  };
  return { executionMode: 'hosted', verifiedPackage, targetOrigin, sensitiveValues, observerInputs, request: (url, init) => { if (!identityVerified || !beforeComplete || observationFailed) return Promise.reject(new Error('GUEST_HOSTED_PREFLIGHT_FAILED')); return adapter.request(url, init); }, observations: { before: snapshot, quiesce: adapter.quiesce, after: snapshot }, observerCosts: costs, dispose, limits: { apiCalls: 52, snapshots: 2, rowsPerTable: 2048, rowsPerSnapshot: 8192, responseBytes: 8388608, totalResponseBytes: 33554432, requestTimeoutMs: 10000, snapshotTimeoutMs: 18000, deadlineMs: 300000 }, authorization: { explicitOperatorApproval: true, expectedPackageDigest: expectedDigest, cloudActionAuthorizedByManifest: false } };
}
