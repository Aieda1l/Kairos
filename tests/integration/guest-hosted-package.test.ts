import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { buildGuestHostedApplication, canonical, inspectGuestHostedModules, sanitizedBuildEnvironment, sha256 } from '../../scripts/lib/guest-hosted-build.mjs';
import { prepareGuestHostedPackage, validateGuestHostedInventory, verifyGuestHostedPackage } from '../../scripts/lib/guest-hosted-package.mjs';
import { handleFixtureRequest } from '../../scripts/guest-hosted/fixture-worker.mjs';
import Database from 'better-sqlite3';
import { pathToFileURL } from 'node:url';
import { guestFixtureProtocol } from '../../scripts/lib/guest-hosted-package.mjs';
import { execFileSync } from 'node:child_process';
const workerBindings = vi.hoisted(() => ({
  env: {} as Record<string, unknown>
}));
vi.mock('cloudflare:workers', () => workerBindings);
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile)
  };
});
const originalFetch = globalThis.fetch;
const root = resolve('artifacts/guest-hosted');
const databases: Database.Database[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const db of databases.splice(0)) db.close();
});
async function temporary() {
  await mkdir(root, {
    recursive: true
  });
  return mkdtemp(join(root, 'contract-'));
}
const inventory = () => ({
  version: 1,
  runId: 'h1-contract-001',
  scenario: 'bounded-v1',
  hostname: 'guest-diagnostic.mykairos.me',
  candidateName: 'kairos-guest-app-h1-contract-001',
  fixtureName: 'kairos-guest-fixture-h1-contract-001',
  appDatabaseName: 'kairos-guest-app-h1-contract-001',
  fixtureDatabaseName: 'kairos-guest-fixture-h1-contract-001',
  accountId: null,
  appDatabaseId: null,
  fixtureDatabaseId: null
});
it('rejects missing/full-ref and unowned output before invoking a build', async () => {
  await expect(buildGuestHostedApplication({
    applicationRevision: 'HEAD',
    outputRoot: join(root, 'bad-ref')
  })).rejects.toThrow('GUEST_BUILD_IDENTITY_INVALID');
  await expect(buildGuestHostedApplication({
    applicationRevision: 'f13431c487266c3982b4aa9fdcda29e705aac7e6',
    outputRoot: resolve('../escape')
  })).rejects.toThrow('GUEST_OUTPUT_UNOWNED');
});
it('constructs a child environment without ambient poison, public or E2E inputs', () => {
  process.env.NEXT_PUBLIC_GUEST_POISON = 'poison-value';
  process.env.E2E_FIXTURES = '1';
  process.env.NODE_OPTIONS = '--trace-warnings';
  try {
    const env = sanitizedBuildEnvironment(resolve(root, 'state'));
    expect(env).toMatchObject({
      CLOUDFLARE_VITE_FORCE_LOCAL: 'true',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      WRANGLER_SEND_METRICS: 'false'
    });
    expect(JSON.stringify(env)).not.toContain('poison-value');
    expect(env).not.toHaveProperty('E2E_FIXTURES');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('HOME');
    expect(env).not.toHaveProperty('USERPROFILE');
  } finally {
    delete process.env.NEXT_PUBLIC_GUEST_POISON;
    delete process.env.E2E_FIXTURES;
    delete process.env.NODE_OPTIONS;
  }
});
it('freezes exact identities, prevents widening, production collisions and unresolved operator state', () => {
  expect(validateGuestHostedInventory(inventory(), 'offline').runId).toBe('h1-contract-001');
  for (const change of [{
    hostname: 'mykairos.me'
  }, {
    candidateName: 'kairos'
  }, {
    fixtureDatabaseName: 'kairos-production'
  }, {
    appDatabaseId: '11111111-1111-1111-1111-111111111111'
  }, {
    fixtureName: inventory().candidateName
  }, {
    extraBinding: 'AUTH_SECRET'
  }, {
    runId: ''
  }]) expect(() => validateGuestHostedInventory({
    ...inventory(),
    ...change
  }, 'offline')).toThrow('GUEST_INVENTORY_INVALID');
  expect(() => validateGuestHostedInventory(inventory(), 'operator-ready')).toThrow('GUEST_INVENTORY_UNRESOLVED');
});
it('inventories original bytes and literal module edges, rejecting unresolved and computed imports', async () => {
  const dir = await temporary();
  await writeFile(join(dir, 'index.js'), "import './chunk.js';export default {fetch(){return new Response('ok')}}");
  await writeFile(join(dir, 'chunk.js'), 'export const x=1;');
  const result = await inspectGuestHostedModules(dir);
  expect(result.modules.map((v: {
    path: string;
  }) => v.path)).toEqual(['chunk.js', 'index.js']);
  expect(result.modules.every((v: {
    sha256: string;
  }) => /^[a-f0-9]{64}$/.test(v.sha256))).toBe(true);
  await writeFile(join(dir, 'chunk.js'), "export const x=import('node:https');");
  await expect(inspectGuestHostedModules(dir)).rejects.toThrow('GUEST_MODULE_UNSUPPORTED');
  await writeFile(join(dir, 'chunk.js'), 'export const x=import(globalThis.destination);');
  await expect(inspectGuestHostedModules(dir)).rejects.toThrow('GUEST_MODULE_UNSUPPORTED');
  await writeFile(join(dir, 'chunk.js'), "export const x=import('./missing.js');");
  await expect(inspectGuestHostedModules(dir)).rejects.toThrow('GUEST_MODULE_UNRESOLVED');
});
it('rejects emitted environment material and symlink/path escapes without reading their values', async () => {
  const dir = await temporary();
  await writeFile(join(dir, 'index.js'), 'export default {};');
  await writeFile(join(dir, '.dev.vars'), 'DO_NOT_READ=poison');
  await expect(inspectGuestHostedModules(dir)).rejects.toThrow('GUEST_BUILD_ENV_OUTPUT');
  const other = await temporary(),
    target = await temporary();
  await writeFile(join(other, 'index.js'), 'export default {};');
  await symlink(target, join(other, 'escaped'), 'junction');
  await expect(inspectGuestHostedModules(other)).rejects.toThrow('GUEST_PATH_UNSAFE');
});
async function fixture(cap = 2) {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(await readFile('scripts/guest-hosted/control-schema.sql', 'utf8'));
  sqlite.prepare('INSERT INTO fixture_operation(run_id,scenario,operation,call_cap) VALUES(?,?,?,?)').run('h1-contract-001', 'bounded-v1', 'canvas-smoke', cap);
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => ({
          success: true,
          results: sqlite.prepare(sql).all(...args)
        })
      })
    })
  };
  const scenario = {
    version: 1,
    runId: 'h1-contract-001',
    scenario: 'bounded-v1',
    hostname: 'guest-diagnostic.mykairos.me',
    operations: [{
      key: 'canvas-smoke',
      method: 'GET',
      url: 'https://canvas.uw.edu/feeds/calendars/hosted-smoke.ics',
      cap,
      body: 'canvas-smoke',
      contentType: 'text/calendar'
    }]
  };
  return {
    sqlite,
    db,
    scenario,
    bodies: {
      'canvas-smoke': new TextEncoder().encode('synthetic-body')
    }
  };
}
it('admits at most the atomic cap under concurrency, then fails closed without resetting', async () => {
  const {
    sqlite,
    db,
    scenario,
    bodies
  } = await fixture();
  const responses = await Promise.all(Array.from({
    length: 6
  }, () => handleFixtureRequest(new Request(scenario.operations[0].url, {
    redirect: 'manual'
  }), {
    FIXTURE_DB: db
  }, scenario, bodies)));
  expect(responses.filter((r: Response) => r.ok)).toHaveLength(2);
  expect(responses.filter((r: Response) => r.status === 503)).toHaveLength(4);
  expect(sqlite.prepare('SELECT calls FROM fixture_operation').get()).toEqual({
    calls: 2
  });
});
it('denies unknown/admin/destination/method/credential and broken counters with fixed errors', async () => {
  const {
    db,
    scenario,
    bodies,
    sqlite
  } = await fixture();
  for (const request of [new Request('https://fixture.invalid/reset'), new Request(scenario.operations[0].url, {
    method: 'POST',
    redirect: 'manual'
  }), new Request(scenario.operations[0].url, {
    redirect: 'follow'
  }), new Request(scenario.operations[0].url, {
    headers: {
      authorization: 'Bearer forbidden'
    },
    redirect: 'manual'
  })]) {
    const response = await handleFixtureRequest(request, {
      FIXTURE_DB: db
    }, scenario, bodies);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('GUEST_FIXTURE_DENIED');
  }
  expect(sqlite.prepare('SELECT calls FROM fixture_operation').get()).toEqual({
    calls: 0
  });
  const response = await handleFixtureRequest(new Request(scenario.operations[0].url, {
    redirect: 'manual'
  }), {
    FIXTURE_DB: {
      prepare() {
        throw new Error('private-poison');
      }
    }
  }, scenario, bodies);
  expect(response.status).toBe(503);
  expect(await response.text()).toBe('GUEST_FIXTURE_UNAVAILABLE');
});

// The package tests consume a fresh build receipt supplied by the native preparation run.
// Without one they build a new original graph; never fall back to the checkout dist.
describe('fresh original package', () => {
  let receipt: Awaited<ReturnType<typeof buildGuestHostedApplication>>;
  let prepared: Awaited<ReturnType<typeof prepareGuestHostedPackage>>;
  beforeAll(async () => {
    if (process.env.GUEST_HOSTED_TEST_BUILD_RECEIPT) receipt = JSON.parse(await readFile(process.env.GUEST_HOSTED_TEST_BUILD_RECEIPT, 'utf8'));else receipt = await buildGuestHostedApplication({
      applicationRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8'
      }).trim(),
      outputRoot: join(await temporary(), 'fresh-build')
    });
    prepared = await prepareGuestHostedPackage({
      buildReceipt: receipt,
      inventory: inventory(),
      outputRoot: join(await temporary(), 'package')
    });
  }, 120000);
  it('prepares only hash-inventoried byte-identical original modules with explicit private configs', async () => {
    const verified = await verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory(),
      mode: 'offline'
    });
    expect(verified.deployable).toBe(false);
    expect(verified.cloudActionAuthorized).toBe(false);
    const root = dirname(prepared.manifestPath),
      candidate = JSON.parse(await readFile(join(root, 'wrangler.candidate.json'), 'utf8')),
      fixture = JSON.parse(await readFile(join(root, 'wrangler.fixture.json'), 'utf8'));
    expect(candidate).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      no_bundle: true,
      services: [{
        binding: 'GUEST_FIXTURE',
        service: inventory().fixtureName
      }, {
        binding: 'ASSETS',
        service: inventory().fixtureName
      }]
    });
    expect(fixture).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      routes: [],
      d1_databases: [{
        binding: 'FIXTURE_DB'
      }]
    });
    expect(candidate).not.toHaveProperty('assets');
    expect(fixture).not.toHaveProperty('services');
    for (const compiledModule of receipt.graph.modules) {
      const bytes = await readFile(join(root, 'app/server', compiledModule.path));
      expect(bytes).toEqual(await readFile(join(receipt.sourceRoot, 'dist/server', compiledModule.path)));
      expect(bytes.includes(Buffer.from('H1_POISON_SENTINEL'))).toBe(false);
    }
    expect(JSON.stringify(verified.manifest)).not.toContain('H1_POISON_SENTINEL');
    await expect(verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory(),
      mode: 'operator-ready'
    })).rejects.toThrow('GUEST_INVENTORY_UNRESOLVED');
  });
  it('rejects file/config/undeclared/module/source drift and missing binding even when manifest hashes are recomputed', async () => {
    const root = dirname(prepared.manifestPath),
      manifestRaw = await readFile(prepared.manifestPath, 'utf8');
    const target = join(root, 'app/server/index.js'),
      original = await readFile(target);
    await writeFile(target, Buffer.concat([original, Buffer.from('\n// drift')]));
    await expect(verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory()
    })).rejects.toThrow('GUEST_PACKAGE_FILE_DRIFT');
    await writeFile(target, original);
    const moduleManifest = JSON.parse(manifestRaw),
      changedModule = Buffer.concat([original, Buffer.from('\n// changed-original')]);
    await writeFile(target, changedModule);
    const moduleEntry = moduleManifest.files.find((entry: {
      path: string;
    }) => entry.path === 'app/server/index.js');
    moduleEntry.sha256 = sha256(changedModule);
    moduleEntry.bytes = changedModule.length;
    delete moduleManifest.packageDigest;
    moduleManifest.packageDigest = sha256(canonical(moduleManifest));
    await writeFile(prepared.manifestPath, JSON.stringify(moduleManifest));
    await expect(verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory()
    })).rejects.toThrow('GUEST_MODULE_DRIFT');
    await writeFile(target, original);
    await writeFile(prepared.manifestPath, manifestRaw);
    await writeFile(join(root, 'undeclared.txt'), 'extra');
    await expect(verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory()
    })).rejects.toThrow('GUEST_PACKAGE_FILES_DRIFT');
    await unlink(join(root, 'undeclared.txt'));
    const configPath = join(root, 'wrangler.candidate.json'),
      configRaw = await readFile(configPath, 'utf8'),
      config = JSON.parse(configRaw);
    config.services.pop();
    const changed = JSON.stringify(config);
    await writeFile(configPath, changed);
    const manifest = JSON.parse(manifestRaw),
      entry = manifest.files.find((entry: {
        path: string;
      }) => entry.path === 'wrangler.candidate.json');
    entry.sha256 = sha256(changed);
    entry.bytes = Buffer.byteLength(changed);
    delete manifest.packageDigest;
    manifest.packageDigest = sha256(canonical(manifest));
    await writeFile(prepared.manifestPath, JSON.stringify(manifest));
    await expect(verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory()
    })).rejects.toThrow('GUEST_CONFIG_DRIFT');
    await writeFile(configPath, configRaw);
    await writeFile(prepared.manifestPath, manifestRaw);
    const sourcePath = join(receipt.sourceRoot, 'src/lib/guest/limits.ts'),
      sourceRaw = await readFile(sourcePath);
    await writeFile(sourcePath, Buffer.concat([sourceRaw, Buffer.from('\n// drift')]));
    await expect(verifyGuestHostedPackage({
      ...prepared,
      inventory: inventory()
    })).rejects.toThrow('GUEST_SOURCE_DRIFT');
    await writeFile(sourcePath, sourceRaw);
  }, 30000);
  it('rejects a recomputed inventory for a tampered wrapper derived from owned source', async () => {
    const root = dirname(prepared.manifestPath),
      manifestRaw = await readFile(prepared.manifestPath, 'utf8'),
      target = join(root, 'prelude.mjs'),
      original = await readFile(target),
      changed = Buffer.concat([original, Buffer.from('\n// tampered-wrapper')]);
    const manifest = JSON.parse(manifestRaw),
      entry = manifest.files.find((entry: {
        path: string;
      }) => entry.path === 'prelude.mjs');
    entry.sha256 = sha256(changed);
    entry.bytes = changed.length;
    delete manifest.packageDigest;
    manifest.packageDigest = sha256(canonical(manifest));
    try {
      await writeFile(target, changed);
      await writeFile(prepared.manifestPath, JSON.stringify(manifest));
      await expect(verifyGuestHostedPackage({
        ...prepared,
        inventory: inventory()
      })).rejects.toThrow('GUEST_GENERATED_FILE_DRIFT');
    } finally {
      await writeFile(target, original);
      await writeFile(prepared.manifestPath, manifestRaw);
    }
  });
  it('rejects an intermediate emitted-output junction before reading any module', async () => {
    const dist = join(receipt.sourceRoot, 'dist'),
      saved = join(receipt.outputRoot, 'dist-fix-round-1-saved'),
      outside = await temporary();
    for (const path of [dist, saved]) expect(relative(root, resolve(path)).startsWith('..')).toBe(false);
    expect((await lstat(dist)).isSymbolicLink()).toBe(false);
    await mkdir(join(outside, 'server'));
    await writeFile(join(outside, 'server/index.js'), 'export default {};');
    await rename(dist, saved);
    try {
      await symlink(outside, dist, 'junction');
      vi.mocked(readFile).mockClear();
      let failure: unknown;
      try {
        await prepareGuestHostedPackage({
          buildReceipt: receipt,
          inventory: inventory(),
          outputRoot: join(await temporary(), 'junction-package')
        });
      } catch (error) {
        failure = error;
      }
      const emittedReads = vi.mocked(readFile).mock.calls.filter(([path]) => String(path).startsWith(join(dist, 'server') + sep));
      expect(emittedReads).toHaveLength(0);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('GUEST_PATH_UNSAFE');
    } finally {
      await unlink(dist);
      await rename(saved, dist);
    }
  });
  async function transport(target: 'prelude' | 'fixture') {
    let dispatches = 0,
      reservations = 0;
    Object.assign(workerBindings.env, {
      KAIROS_TURNSTILE_SECRET_KEY: 'contract-synthetic-secret',
      GUEST_FIXTURE_CHALLENGE_TOKEN: 'contract-synthetic-challenge',
      GUEST_FIXTURE: {
        fetch: async (request: Request) => {
          dispatches++;
          return new Response(await request.text());
        }
      }
    });
    const protocol = guestFixtureProtocol(inventory());
    const env = {
      ...workerBindings.env,
      FIXTURE_DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              reservations++;
              return {
                success: true,
                results: [{
                  calls: 1,
                  call_cap: 16
                }]
              };
            }
          })
        })
      }
    };
    const prelude = target === 'prelude' ? await import(/* @vite-ignore */pathToFileURL(join(dirname(prepared.manifestPath), 'prelude.mjs')).href) : null;
    return {
      invoke: (request: Request): Promise<Response> => target === 'prelude' ? prelude.fixtureFetch(request) : handleFixtureRequest(request, env, protocol as unknown as Parameters<typeof handleFixtureRequest>[2], {
        challenge: new TextEncoder().encode('challenge-ok')
      }),
      counts: () => ({
        dispatches,
        reservations
      })
    };
  }
  async function deadline<T>(promise: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise.then(value => ({
        kind: 'value' as const,
        value
      }), error => ({
        kind: 'error' as const,
        error
      })), new Promise<{
        kind: 'timeout';
      }>(resolve => {
        timer = setTimeout(() => resolve({
          kind: 'timeout'
        }), 150);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  function challengeRequest(signal: AbortSignal, stalled = false) {
    let controller!: ReadableStreamDefaultController<Uint8Array>,
      cancellations = 0;
    const form = 'secret=contract-synthetic-secret&response=contract-synthetic-challenge';
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        if (!stalled) {
          value.enqueue(new TextEncoder().encode(form));
          value.close();
        }
      },
      cancel() {
        cancellations++;
        if (stalled) return new Promise<void>(() => {});
      }
    });
    const request = new Request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      duplex: 'half'
    } as RequestInit & {
      duplex: string;
    });
    return {
      request,
      form,
      cleanup: () => {
        if (!cancellations) try {
          controller.error(new Error('CONTRACT_STREAM_CLEANUP'));
        } catch {}
      },
      cancellations: () => cancellations
    };
  }
  it.each(['prelude', 'fixture'] as const)('%s denies a pre-aborted challenge without dispatch/reservation or private reason', async target => {
    const adapter = await transport(target),
      controller = new AbortController();
    controller.abort(new Error('private-abort-poison'));
    const input = challengeRequest(controller.signal, true);
    try {
      const result = await deadline(adapter.invoke(input.request));
      expect(result.kind).not.toBe('timeout');
      if (target === 'prelude') {
        expect(result.kind).toBe('error');
        if (result.kind === 'error') expect(result.error.message).toBe('GUEST_TRANSPORT_DENIED');
      } else {
        expect(result.kind).toBe('value');
        if (result.kind === 'value') {
          expect(result.value.status).toBe(503);
          expect(await result.value.text()).toBe('GUEST_FIXTURE_UNAVAILABLE');
        }
      }
      expect(adapter.counts()).toEqual({
        dispatches: 0,
        reservations: 0
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(input.cancellations()).toBe(1);
    } finally {
      input.cleanup();
    }
  });
  it.each(['prelude', 'fixture'] as const)('%s settles a stalled challenge when aborted mid-read with no dispatch/reservation', async target => {
    const adapter = await transport(target),
      controller = new AbortController(),
      input = challengeRequest(controller.signal, true);
    const added = vi.spyOn(input.request.signal, 'addEventListener'),
      removed = vi.spyOn(input.request.signal, 'removeEventListener');
    const pending = adapter.invoke(input.request);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort(new Error('private-abort-poison'));
    try {
      const result = await deadline(pending);
      expect(result.kind).not.toBe('timeout');
      if (target === 'prelude') {
        expect(result.kind).toBe('error');
        if (result.kind === 'error') expect(result.error.message).toBe('GUEST_TRANSPORT_DENIED');
      } else {
        expect(result.kind).toBe('value');
        if (result.kind === 'value') {
          expect(result.value.status).toBe(503);
          expect(await result.value.text()).toBe('GUEST_FIXTURE_UNAVAILABLE');
        }
      }
      expect(adapter.counts()).toEqual({
        dispatches: 0,
        reservations: 0
      });
      if (target === 'fixture') expect(added.mock.calls.filter(([name]) => name === 'abort').some(([, listener]) => removed.mock.calls.some(([name, removedListener]) => name === 'abort' && removedListener === listener))).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(input.cancellations()).toBe(1);
    } finally {
      added.mockRestore();
      removed.mockRestore();
      input.cleanup();
      await pending.catch(() => {});
    }
  });
  it.each(['prelude', 'fixture'] as const)('%s preserves accepted challenge body delivery', async target => {
    const adapter = await transport(target),
      input = challengeRequest(new AbortController().signal),
      added = vi.spyOn(input.request.signal, 'addEventListener'),
      removed = vi.spyOn(input.request.signal, 'removeEventListener');
    try {
      const result = await deadline(adapter.invoke(input.request));
      expect(result.kind).toBe('value');
      if (result.kind !== 'value') return;
      expect(result.value.status).toBe(200);
      if (target === 'prelude') expect(await result.value.text()).toBe(input.form);else expect(await input.request.text()).toBe(input.form);
      expect(adapter.counts()).toEqual(target === 'prelude' ? {
        dispatches: 1,
        reservations: 0
      } : {
        dispatches: 0,
        reservations: 1
      });
      if (target === 'fixture') expect(added.mock.calls.filter(([name]) => name === 'abort').some(([, listener]) => removed.mock.calls.some(([name, removedListener]) => name === 'abort' && removedListener === listener))).toBe(true);
    } finally {
      added.mockRestore();
      removed.mockRestore();
      input.cleanup();
    }
  });
  it.each(['prelude', 'fixture'] as const)('%s bounds an oversized open challenge without waiting for cancellation', async target => {
    const adapter = await transport(target);
    let cancellations = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16385));
      },
      cancel() {
        cancellations++;
        return new Promise<void>(() => {});
      }
    });
    const request = new Request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      redirect: 'manual',
      body,
      duplex: 'half'
    } as RequestInit & {
      duplex: string;
    });
    const result = await deadline(adapter.invoke(request));
    expect(result.kind).not.toBe('timeout');
    if (target === 'prelude') {
      expect(result.kind).toBe('error');
      if (result.kind === 'error') expect(result.error.message).toBe('GUEST_TRANSPORT_DENIED');
    } else {
      expect(result.kind).toBe('value');
      if (result.kind === 'value') {
        expect(result.value.status).toBe(502);
        expect(await result.value.text()).toBe('GUEST_FIXTURE_DENIED');
      }
    }
    expect(adapter.counts()).toEqual({
      dispatches: 0,
      reservations: 0
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancellations).toBe(1);
  });
});
