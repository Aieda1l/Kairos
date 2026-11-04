import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildGuestHostedApplication, canonical, inspectGuestHostedModules, sanitizedBuildEnvironment, sha256 } from '../../scripts/lib/guest-hosted-build.mjs';
import { prepareGuestHostedPackage, validateGuestHostedInventory, verifyGuestHostedPackage } from '../../scripts/lib/guest-hosted-package.mjs';
import { handleFixtureRequest } from '../../scripts/guest-hosted/fixture-worker.mjs';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
const root = resolve('artifacts/guest-hosted');
const databases: Database.Database[] = [];
afterEach(() => {
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
});
