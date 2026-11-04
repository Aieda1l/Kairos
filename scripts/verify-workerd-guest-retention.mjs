// Standalone LOCAL-ONLY proof. No Wrangler CLI, remote bindings, env files or credentials.
import {Miniflare, Log, LogLevel, convertV4MiniflareOptions} from 'miniflare';
import {mkdir, readFile, readdir, writeFile, rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {runGuestRetentionValidation, sha256} from './lib/guest-retention-probe.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const started = new Date().toISOString();
const directory = join(root, 'artifacts/guest-retention', `${started.replace(/[:.]/g, '-')}-${randomUUID()}-native`);
let source;
let schema;
const config = {cf: false, telemetry: false, persistence: false, credentials: false, compatibilityDate: '2026-10-06',
  outboundService: 'deny', database: 'disposable-synthetic-guest-retention'};
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();

async function open() {
  await mkdir(directory, {recursive: true});
  const migrations = (await readdir(join(root, 'migrations'))).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  const inputs = ['scripts/verify-workerd-guest-retention.mjs', 'scripts/lib/guest-retention-probe.mjs',
    'scripts/lib/guest-retention-probe.d.mts',
    'scripts/lib/abuse-maintenance.mjs', 'tests/integration/guest-retention-probe.test.ts',
    'package.json', 'package-lock.json', 'wrangler.jsonc', ...migrations.map(name => 'migrations/' + name)];
  const hashes = Object.fromEntries(await Promise.all(inputs.map(async path => [path, sha256(await readFile(join(root, path)))])));
  source = {ref: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0, sha256: hashes};
  const shared = {modules: true, compatibilityDate: config.compatibilityDate, outboundService: config.outboundService};
  const options = convertV4MiniflareOptions({cf: false, log: new Log(LogLevel.NONE), workers: [
    {...shared, name: 'retention', script: 'export default {fetch(){return new Response(null,{status:404});}};',
      d1Databases: {DB: config.database}},
    {...shared, name: 'deny', script: `let attempts=0;export default {fetch(request){if(new URL(request.url).origin==='http://driver.invalid')return Response.json({attempts});attempts++;return new Response(null,{status:502});}};`},
  ]});
  options.telemetry = {enabled: false};
  const mf = new Miniflare(options);
  try {
    await mf.ready;
    const db = await mf.getD1Database('DB', 'retention');
    for (const name of migrations) {
      const sql = await readFile(join(root, 'migrations', name), 'utf8');
      for (const statement of sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim()).filter(Boolean)) {
        assert.equal((await db.prepare(statement).run()).success, true);
      }
    }
    const definitions = await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY type,name").all();
    assert.equal(definitions.success, true);
    schema = {migrations: migrations.length, sha256: sha256(JSON.stringify(definitions.results))};
    return {db, dispose: () => mf.dispose(), outboundAttempts: async () => {
      const response = await (await mf.getWorker('deny')).fetch('http://driver.invalid/stats');
      return (await response.json()).attempts;
    }};
  } catch {
    await mf.dispose();
    throw new Error('GUEST_RETENTION_VALIDATION_FAILED');
  }
}

process.exitCode = await runGuestRetentionValidation({open,
  diagnostic: message => console.error(message),
  writeReceipt: async result => {
    // Refuse provenance drift during the run; the receipt is published only after disposal.
    assert.equal(git('rev-parse', 'HEAD'), source.ref);
    for (const [path, hash] of Object.entries(source.sha256)) assert.equal(sha256(await readFile(join(root, path))), hash);
    const receipt = {schemaVersion: 1, evidenceType: 'local-native-workerd-d1', startedAt: started,
      completedAt: new Date().toISOString(), source, schema, config, configSha256: sha256(JSON.stringify(config)),
      runtime: {node: process.version, platform: process.platform, arch: process.arch},
      hostedCpuMs: null, hostedMemoryBytes: null, hostedD1Billing: null, physicalRetentionBoundMs: null,
      ...result};
    const raw = JSON.stringify(receipt, null, 2) + '\n';
    await writeFile(join(directory, 'receipt.pending.json'), raw, {encoding: 'utf8', flag: 'wx'});
    await rename(join(directory, 'receipt.pending.json'), join(directory, 'receipt.json'));
    console.log(JSON.stringify({code: result.code, receiptSha256: sha256(raw),
      expiredAnonymousBefore: result.expiredAnonymousBefore, expiredAnonymousAfter: result.expiredAnonymousAfter,
      applyInvocations: result.applies.length, outboundAttempts: result.outboundAttempts}));
  },
});
