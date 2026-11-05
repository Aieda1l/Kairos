// No implicit network, credentials, provisioning, upload or hosted execution.
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { prepareGuestHostedPackage, verifyGuestHostedPackage } from './lib/guest-hosted-package.mjs';
import { NATIVE_INVENTORY, NATIVE_PACKAGE_DIGEST } from './lib/guest-hosted-native.mjs';
import { makeGuestWorkload } from './lib/guest-hosted-native.mjs';
import { ownedOutput, sha256 } from './lib/guest-hosted-build.mjs';
import { loadGuestHostedSchemas, runGuestHostedDiagnostic } from './lib/guest-hosted-diagnostic.mjs';
import { prepareHostedDiagnostic } from './lib/guest-hosted-observations.mjs';

async function readOperatorFile(path) {
  const resolved = resolve(path);
  const stat = await lstat(resolved);
  if (!resolved.endsWith('.json') || basename(resolved).startsWith('.') || stat.isSymbolicLink() || !stat.isFile() || stat.size > 65536) throw new Error();
  return JSON.parse(await readFile(resolved, 'utf8'));
}
async function readCredentials() {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', failed); process.stdin.pause(); };
    const failed = () => { cleanup(); reject(new Error('GUEST_HOSTED_INPUT_FAILED')); };
    const data = chunk => { bytes += chunk.length; if (bytes > 32768) { failed(); return; } chunks.push(chunk); };
    const end = () => { cleanup(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new Error('GUEST_HOSTED_INPUT_FAILED')); } };
    const timer = setTimeout(failed, 30000);
    process.stdin.on('data', data).once('end', end).once('error', failed).resume();
  });
}

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === '--verify-prepared') {
    const result = await verifyGuestHostedPackage({ manifestPath: resolve('artifacts/guest-hosted/package-h1-native-fix1/manifest.json'), inventory: NATIVE_INVENTORY, mode: 'offline' });
    if (result.packageDigest !== NATIVE_PACKAGE_DIGEST) throw new Error();
    console.log(JSON.stringify({ status: 'prepared-only', packageDigest: result.packageDigest, deployable: false, cloudActionAuthorized: false }));
  } else if (args.length === 3 && args[0] === '--prepare') {
    const inventory = await readOperatorFile(args[1]);
    // Use the immutable accepted build; no Vite rebuild or ambient env loading.
    const buildReceipt = JSON.parse(await readFile(resolve('artifacts/guest-hosted/build-h1-002/build-receipt.json'), 'utf8'));
    const result = await prepareGuestHostedPackage({ buildReceipt, inventory, outputRoot: resolve(args[2]) });
    console.log(JSON.stringify({ status: 'prepared-only', manifestPath: join(resolve(args[2]), 'manifest.json'), packageDigest: result.packageDigest, deployable: false, cloudActionAuthorized: false }));
  } else if (args.length === 3 && args[0] === '--hosted') {
    // An explicit approved future run. Never invoked by preparation or native proof.
    const input = await readOperatorFile(args[1]);
    const credentials = await readCredentials();
    const prepared = await prepareHostedDiagnostic({ input, expectedDigest: args[2], credentials });
    let result, output;
    try {
      const { schemas, provenance } = await loadGuestHostedSchemas();
      output = await ownedOutput(resolve('artifacts/guest-hosted/hosted-' + input.inventory.runId + '-' + Date.now()));
      await mkdir(output);
      const diagnostic = await runGuestHostedDiagnostic({ ...prepared, workload: makeGuestWorkload(), schemas });
      result = { ...diagnostic, executionMode: 'hosted', nativeOnly: false, authorization: prepared.authorization, observerCosts: prepared.observerCosts, observerLimits: prepared.limits, schemaProvenance: provenance, costs: { ...diagnostic.costs, setup: null, fixture: null, observer: prepared.observerCosts, teardown: null }, unmeasuredReasons: { setup: 'operator_setup_outside_driver', fixture: 'fixture_workload_cost_not_observed_per_request', hostedAnalytics: 'graphql_templates_not_executed', teardown: 'explicit_operator_teardown_outside_driver' } };
    } finally {
      try { await prepared.dispose(); }
      catch { if (result) { result.status = 'incomplete'; result.code = 'GUEST_HOSTED_CLEANUP_FAILED'; } else throw new Error(); }
    }
    await writeFile(join(output, 'receipt.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    await writeFile(join(output, 'hash-index.json'), JSON.stringify([{ path: 'receipt.json', sha256: sha256(await readFile(join(output, 'receipt.json'))) }], null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ status: result.status, code: result.code, executionMode: 'hosted' }));
    if (result.status !== 'passed') process.exitCode = 1;
  } else {
    console.error('GUEST_EXPLICIT_ADAPTER_REQUIRED');
    process.exitCode = 1;
  }
} catch {
  console.error('GUEST_DIAGNOSTIC_PREPARATION_FAILED');
  process.exitCode = 1;
}
