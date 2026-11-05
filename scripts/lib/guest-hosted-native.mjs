// Local proof adapters only. No hosted fetch, account or deployment adapter.
import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { canonical, sha256 } from './guest-hosted-build.mjs';
import { GUEST_ROUTES } from './guest-hosted-package.mjs';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const argument = value => typeof value === 'string' && value.trim() === value && value.length > 0 && !value.startsWith('--') && !/[\0\r\n]/.test(value);
export function parseNativeProofArguments(args) {
  if (!Array.isArray(args) || args.length !== 4 || !args.every(argument) || !digest(args[2])) throw new Error('GUEST_NATIVE_INPUT_REQUIRED');
  return { manifestPath: args[0], inventoryPath: args[1], expectedDigest: args[2], evidenceRoot: args[3] };
}
export function parseGuestHostedArguments(args) {
  if (!Array.isArray(args) || args.length !== 4 || !args.slice(1).every(argument)) throw new Error('GUEST_EXPLICIT_ADAPTER_REQUIRED');
  if (args[0] === '--prepare') return { mode: 'prepare', buildReceiptPath: args[1], inventoryPath: args[2], outputRoot: args[3] };
  if (args[0] === '--verify-prepared' && digest(args[3])) return { mode: 'verify-prepared', manifestPath: args[1], inventoryPath: args[2], expectedDigest: args[3] };
  if (args[0] === '--hosted' && digest(args[2])) return { mode: 'hosted', operatorInputPath: args[1], expectedDigest: args[2], evidenceRoot: args[3] };
  throw new Error('GUEST_EXPLICIT_ADAPTER_REQUIRED');
}
export async function readGuestHostedJson(path, maxBytes = 65536) {
  const resolved = resolve(path), stat = await lstat(resolved);
  if (!resolved.endsWith('.json') || basename(resolved).startsWith('.') || stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) throw new Error('GUEST_OPERATOR_INPUT_INVALID');
  return JSON.parse(await readFile(resolved, 'utf8'));
}

export function orderNativeModules(paths, main) {
  const safe = path => typeof path === 'string' && !path.includes('\\') && !path.includes(':') && path.split('/').every(part => part && part !== '.' && part !== '..');
  const entry = typeof main === 'string' && main.startsWith('./') ? main.slice(2) : null;
  if (!Array.isArray(paths) || !entry || !safe(entry) || paths.some(path => !safe(path)) || new Set(paths).size !== paths.length || !paths.includes(entry)) throw new Error('GUEST_NATIVE_ENTRY_INVALID');
  return [entry, ...paths.filter(path => path !== entry).sort()];
}

export function makeGuestWorkload() {
  const source = (kind, near, phase) => ({ method: 'POST', path: kind === 'canvas' ? '/api/guest/sources/canvas/feed' : '/api/guest/sources/ed/' + kind, near, phase, requestId: randomUUID(), expectedCount: near ? kind === 'canvas' ? 2000 : kind === 'courses' ? 500 : 1000 : 1, ...(kind === 'lessons' ? { courseId: '12' } : {}) });
  return [
    { method: 'GET', path: '/api/health', phase: 0 },
    { method: 'POST', path: '/api/guest/session', phase: 1, requestId: randomUUID() },
    ...['canvas', 'courses', 'lessons'].map(kind => source(kind, false, 2)),
    { method: 'POST', path: '/api/guest/session', case: 'wrong-origin', phase: 3, requestId: randomUUID() },
    { method: 'POST', path: '/api/guest/sources/ed/courses', case: 'missing-capability', phase: 3, requestId: randomUUID() },
    ...['canvas', 'canvas', 'courses', 'courses', 'lessons', 'lessons'].map(kind => source(kind, true, 4))
  ];
}

export function readGuestCookie(header) {
  const parts = typeof header === 'string' ? header.split(';').map(value => value.trim()) : [];
  const expected = ['httponly', 'max-age=1800', 'path=/', 'samesite=strict', 'secure'];
  if (!/^__Host-kairos-guest-sync=[^;\s,]+$/.test(parts[0] ?? '') || canonical(parts.slice(1).map(value => value.toLowerCase()).sort()) !== canonical(expected)) throw new Error('GUEST_COOKIE_INVALID');
  return parts[0];
}

export const tableDigest = rows => ({ count: rows.length, sha256: sha256(canonical(rows.map(row => canonical(row)).sort())) });

export function preserveAdmissions(before, after) {
  const remaining = new Map();
  for (const row of before) { const key = canonical(row); remaining.set(key, (remaining.get(key) ?? 0) + 1); }
  for (const row of after) {
    const key = canonical(row), count = remaining.get(key) ?? 0;
    if (count) remaining.set(key, count - 1);
    else if (row.user_id !== null) return false;
  }
  return [...remaining.values()].every(count => count === 0);
}

export function createNativeRequestAdapter({ origin, secrets, sensitiveValues, fetch, syntheticClientAddress = true }) {
  if (origin !== 'https://guest-diagnostic.mykairos.me' || !Array.isArray(sensitiveValues) || typeof fetch !== 'function') throw new Error('GUEST_NATIVE_TARGET_INVALID');
  let cookie, active = 0, failed = false;
  const request = async (url, init) => {
    const item = init?.item;
    if (!GUEST_ROUTES.some(route => route.path === item?.path && route.method === item?.method) || url !== origin + item.path || init.method !== item.method || init.redirect !== 'manual') throw new Error('GUEST_NATIVE_TARGET_INVALID');
    const headers = { 'x-guest-operator': secrets.GUEST_OPERATOR_SECRET, origin: item.case === 'wrong-origin' ? 'https://localhost' : origin, 'content-type': 'application/json', ...(syntheticClientAddress ? { 'cf-connecting-ip': '198.51.100.17' } : {}) };
    if (cookie && item.case !== 'missing-capability') headers.cookie = cookie;
    let body;
    if (item.method === 'POST') {
      const common = { schemaVersion: 1, requestId: item.requestId };
      body = JSON.stringify(item.path.endsWith('/session') ? { ...common, turnstileToken: secrets.GUEST_FIXTURE_CHALLENGE_TOKEN } : item.path.endsWith('/feed') ? { ...common, feedUrl: 'https://canvas.uw.edu/feeds/calendars/hosted-' + (item.near ? 'near' : 'smoke') + '.ics' } : { ...common, token: item.near ? secrets.GUEST_FIXTURE_ED_NEAR_TOKEN : secrets.GUEST_FIXTURE_ED_SMOKE_TOKEN, ...(item.path.endsWith('/lessons') ? { courseId: item.courseId } : {}) });
    }
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    try {
      const response = await fetch(url, { method: item.method, headers, body, redirect: 'manual', signal: init.signal });
      if (response.redirected || response.url && response.url !== url) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* best effort */ }
        throw new Error('GUEST_NATIVE_TARGET_INVALID');
      }
      if (item.path.endsWith('/session') && !item.case && response.status === 200) {
        cookie = readGuestCookie(response.headers.get('set-cookie'));
        sensitiveValues.push(cookie, cookie.slice(cookie.indexOf('=') + 1));
      }
      if (!response.body) { release(); return response; }
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) { release(); reader.releaseLock(); controller.close(); }
            else controller.enqueue(part.value);
          } catch { failed = true; release(); try { reader.releaseLock(); } catch { /* pending read */ } controller.error(new Error('GUEST_NATIVE_STREAM_FAILED')); }
        },
        async cancel() { failed = true; try { await reader.cancel(); release(); } finally { try { reader.releaseLock(); } catch { /* pending read */ } } }
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch { failed = true; release(); throw new Error('GUEST_NATIVE_REQUEST_FAILED'); }
  };
  const quiesce = async (timeoutMs = 1000) => {
    const end = Date.now() + Math.max(1, Math.min(timeoutMs, 1000));
    while (active && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 1));
    return active === 0 && (syntheticClientAddress || !failed);
  };
  return { request, quiesce };
}
