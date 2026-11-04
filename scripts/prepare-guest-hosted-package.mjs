// Offline templates only. No provision, upload, deployment or provider request path exists.
import { lstat, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildGuestHostedApplication } from './lib/guest-hosted-build.mjs';
import { prepareGuestHostedPackage } from './lib/guest-hosted-package.mjs';
const args = process.argv.slice(2);
try {
  if (args.length !== 4 || args.some(arg => !arg || arg.startsWith('--'))) throw new Error();
  const [revision, inventoryPath, buildOutput, packageOutput] = args;
  const inputPath = resolve(inventoryPath);
  if (!inputPath.endsWith('.json') || /^\.(?:env|dev\.vars)/i.test(basename(inputPath)) || (await lstat(inputPath)).isSymbolicLink()) throw new Error();
  const inventory = JSON.parse(await readFile(inputPath, 'utf8'));
  const buildReceipt = await buildGuestHostedApplication({
    applicationRevision: revision,
    outputRoot: resolve(buildOutput)
  });
  const result = await prepareGuestHostedPackage({
    buildReceipt,
    inventory,
    outputRoot: resolve(packageOutput)
  });
  console.log(JSON.stringify(result));
} catch {
  console.error('GUEST_PACKAGE_PREPARATION_FAILED');
  process.exitCode = 1;
}
