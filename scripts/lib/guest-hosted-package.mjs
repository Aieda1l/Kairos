// Version-1 offline artifact contract. Deliberately contains no cloud action implementation.
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonical, inspectGuestHostedModules, ownedOutput, safeFiles, sha256, workspaceRoot } from './guest-hosted-build.mjs';
const fail = code => {
  throw new Error(code);
};
async function safeFile(root, path) {
  if (typeof path !== 'string' || path.split('/').some(part => !part || part === '..' || part === '.' || /[\\:]/.test(part))) fail('GUEST_PATH_UNSAFE');
  if ((await lstat(root)).isSymbolicLink()) fail('GUEST_PATH_UNSAFE');
  let current = root;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) fail('GUEST_PATH_UNSAFE');
  }
  return current;
}
export const GUEST_ROUTES = Object.freeze([{
  method: 'GET',
  path: '/api/health'
}, ...['/api/guest/session', '/api/guest/sources/canvas/feed', '/api/guest/sources/ed/courses', '/api/guest/sources/ed/lessons'].map(path => ({
  method: 'POST',
  path
}))]);
export const GUEST_LIMITS = Object.freeze({
  appRequests: 64,
  concurrent: 6,
  requestTimeoutMs: 20000,
  dispatchDeadlineMs: 300000,
  fixtureAdmissions: 128,
  retries: 0,
  redirects: 0
});
export const CANDIDATE_SECRET_NAMES = Object.freeze(['GUEST_OPERATOR_SECRET', 'KAIROS_ABUSE_KEY_V1', 'KAIROS_TURNSTILE_SITE_KEY', 'KAIROS_TURNSTILE_SECRET_KEY', 'GUEST_FIXTURE_CHALLENGE_TOKEN', 'GUEST_FIXTURE_ED_SMOKE_TOKEN', 'GUEST_FIXTURE_ED_NEAR_TOKEN']);
export const FIXTURE_SECRET_NAMES = Object.freeze(['KAIROS_TURNSTILE_SECRET_KEY', 'GUEST_FIXTURE_CHALLENGE_TOKEN', 'GUEST_FIXTURE_ED_SMOKE_TOKEN', 'GUEST_FIXTURE_ED_NEAR_TOKEN']);
const runtimeFiles = [['candidate-entry.mjs', 'entry.mjs'], ['prelude.mjs', 'prelude.mjs'], ['fixture-worker.mjs', 'fixture/worker.mjs'], ['control-schema.sql', 'fixture/control-schema.sql'], ['manifest.schema.json', 'manifest.schema.json'], ['request-body.mjs', 'request-body.mjs'], ['request-body.mjs', 'fixture/request-body.mjs']];
const implementationFiles = ['scripts/prepare-guest-hosted-package.mjs', 'scripts/lib/guest-hosted-build.mjs', 'scripts/lib/guest-hosted-package.mjs', 'scripts/lib/guest-hosted-build.d.mts', 'scripts/lib/guest-hosted-package.d.mts', 'scripts/guest-hosted/fixture-worker.d.mts'];
const identityKeys = ['version', 'runId', 'scenario', 'hostname', 'candidateName', 'fixtureName', 'appDatabaseName', 'fixtureDatabaseName', 'accountId', 'appDatabaseId', 'fixtureDatabaseId'];
const frozenKeys = ['routes', 'limits', 'candidateBindings', 'fixtureBindings', 'candidateSecretNames', 'fixtureSecretNames', 'operations'];
export function guestFixtureProtocol(identity) {
  return {
    version: 1,
    runId: identity.runId,
    scenario: identity.scenario,
    hostname: identity.hostname,
    operations: [{
      key: 'challenge',
      method: 'POST',
      url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      cap: 16,
      body: 'challenge',
      contentType: 'application/json'
    }, ...['smoke', 'near'].map(mode => ({
      key: 'canvas-' + mode,
      method: 'GET',
      url: `https://canvas.uw.edu/feeds/calendars/hosted-${mode}.ics`,
      cap: 8,
      body: 'canvas-' + mode,
      contentType: 'text/calendar'
    })), ...['smoke', 'near'].flatMap(mode => ['courses', 'lessons'].map(kind => ({
      key: `ed-${kind}-${mode}`,
      method: 'GET',
      url: 'https://us.edstem.org/api/' + (kind === 'courses' ? 'user' : 'courses/12/lessons'),
      credentialBinding: mode === 'smoke' ? 'GUEST_FIXTURE_ED_SMOKE_TOKEN' : 'GUEST_FIXTURE_ED_NEAR_TOKEN',
      cap: 16,
      body: `ed-${kind}-${mode}`,
      contentType: 'application/json'
    })))]
  };
}
export function validateGuestHostedInventory(input, mode = 'offline') {
  if (!['offline', 'operator-ready'].includes(mode) || !input || typeof input !== 'object' || Object.keys(input).some(key => ![...identityKeys, ...frozenKeys].includes(key)) || identityKeys.some(key => !(key in input))) fail('GUEST_INVENTORY_INVALID');
  const identity = Object.fromEntries(identityKeys.map(key => [key, input[key]]));
  if (identity.version !== 1 || !/^h[0-9a-z][0-9a-z-]{5,38}$/.test(identity.runId) || identity.scenario !== 'bounded-v1' || identity.hostname !== 'guest-diagnostic.mykairos.me') fail('GUEST_INVENTORY_INVALID');
  const expected = {
    candidateName: `kairos-guest-app-${identity.runId}`,
    fixtureName: `kairos-guest-fixture-${identity.runId}`,
    appDatabaseName: `kairos-guest-app-${identity.runId}`,
    fixtureDatabaseName: `kairos-guest-fixture-${identity.runId}`
  };
  if (Object.entries(expected).some(([key, value]) => identity[key] !== value)) fail('GUEST_INVENTORY_INVALID');
  if (identity.accountId !== null && (!/^[a-f0-9]{32}$/.test(identity.accountId) || /^([a-f0-9])\1{31}$/.test(identity.accountId))) fail('GUEST_INVENTORY_INVALID');
  for (const key of ['appDatabaseId', 'fixtureDatabaseId']) if (identity[key] !== null && (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(identity[key]) || /^([0-9a-f])\1{7}-/.test(identity[key]))) fail('GUEST_INVENTORY_INVALID');
  if (identity.appDatabaseId !== null && identity.appDatabaseId === identity.fixtureDatabaseId) fail('GUEST_INVENTORY_INVALID');
  if (mode === 'operator-ready' && ['accountId', 'appDatabaseId', 'fixtureDatabaseId'].some(key => identity[key] === null)) fail('GUEST_INVENTORY_UNRESOLVED');
  const frozen = {
    ...identity,
    routes: GUEST_ROUTES,
    limits: GUEST_LIMITS,
    candidateBindings: ['DB', 'GUEST_FIXTURE', 'ASSETS'],
    fixtureBindings: ['FIXTURE_DB'],
    candidateSecretNames: CANDIDATE_SECRET_NAMES,
    fixtureSecretNames: FIXTURE_SECRET_NAMES,
    operations: guestFixtureProtocol(identity).operations
  };
  for (const key of frozenKeys) if (key in input && canonical(input[key]) !== canonical(frozen[key])) fail('GUEST_INVENTORY_INVALID');
  return structuredClone(frozen);
}
function generateBodies(protocol) {
  const bodies = {
    challenge: JSON.stringify({
      success: true,
      hostname: protocol.hostname,
      action: 'guest_sync'
    })
  };
  const checkedAt = '2026-11-04T12:00:00.000Z';
  for (const mode of ['smoke', 'near']) {
    const near = mode === 'near';
    const events = Array.from({
      length: near ? 2000 : 1
    }, (_, i) => ['BEGIN:VEVENT', `UID:event-assignment-${i + 1}`, `SUMMARY:${near ? 'N'.repeat(440) : 'Homework'} ${i + 1} [Math]`, 'DTSTART:20261105T120000Z', `URL:https://canvas.uw.edu/courses/12/assignments/${i + 1}`, 'END:VEVENT'].join('\n'));
    let canvas = `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`;
    if (near) canvas = canvas.replace('VERSION:2.0', 'VERSION:2.0\nX-PADDING:' + 'x'.repeat(2 * 1024 * 1024 - 64 - new TextEncoder().encode(canvas).length - 11));
    bodies['canvas-' + mode] = canvas;
    for (const kind of ['courses', 'lessons']) {
      const payload = kind === 'courses' ? {
        user: {
          id: 1
        },
        courses: Array.from({
          length: near ? 500 : 1
        }, (_, i) => ({
          course: {
            id: i + 1,
            code: near ? 'C'.repeat(150) : 'C1',
            name: near ? 'Course '.padEnd(220, 'N') : 'Course',
            year: 2026,
            session: 'Autumn'
          },
          role: {
            role: 'student'
          }
        }))
      } : {
        modules: [],
        lessons: Array.from({
          length: near ? 2000 : 1
        }, (_, i) => ({
          id: i + 1,
          course_id: 12,
          title: near ? 'Lesson '.padEnd(450, 'N') : 'Lesson',
          status: 'unattempted',
          state: 'published',
          is_hidden: near && i >= 1000,
          is_unlisted: false,
          due_at: checkedAt
        }))
      };
      if (near) payload.padding = 'x'.repeat(2 * 1024 * 1024 - 64 - JSON.stringify(payload).length - 13);
      bodies[`ed-${kind}-${mode}`] = JSON.stringify(payload);
    }
  }
  return bodies;
}
function configuration(identity, receipt, component) {
  const candidate = component === 'candidate';
  const original = receipt.compatibility;
  if (!original || original.date !== '2026-10-06' || canonical(original.flags) !== canonical(['nodejs_compat'])) fail('GUEST_BUILD_CONFIG_UNSUPPORTED');
  return {
    name: candidate ? identity.candidateName : identity.fixtureName,
    account_id: identity.accountId ?? 'UNRESOLVED_ACCOUNT_ID',
    main: candidate ? './entry.mjs' : './fixture/entry.mjs',
    compatibility_date: original.date,
    compatibility_flags: original.flags,
    no_bundle: true,
    rules: [{
      type: 'ESModule',
      globs: ['**/*.js', '**/*.mjs'],
      fallthrough: true
    }],
    workers_dev: false,
    preview_urls: false,
    logpush: false,
    observability: {
      enabled: false,
      logs: {
        enabled: false,
        invocation_logs: false,
        persist: false
      },
      traces: {
        enabled: false,
        persist: false
      }
    },
    routes: candidate ? [{
      pattern: identity.hostname,
      custom_domain: true
    }] : [],
    d1_databases: [{
      binding: candidate ? 'DB' : 'FIXTURE_DB',
      database_name: candidate ? identity.appDatabaseName : identity.fixtureDatabaseName,
      database_id: (candidate ? identity.appDatabaseId : identity.fixtureDatabaseId) ?? (candidate ? 'UNRESOLVED_APP_DATABASE_ID' : 'UNRESOLVED_FIXTURE_DATABASE_ID')
    }],
    ...(candidate ? {
      vars: {
        KAIROS_GUEST_ENABLED: 'true',
        KAIROS_APP_URL: `https://${identity.hostname}`,
        KAIROS_ABUSE_TRUSTED_INGRESS: 'cloudflare'
      },
      services: [{
        binding: 'GUEST_FIXTURE',
        service: identity.fixtureName
      }, {
        binding: 'ASSETS',
        service: identity.fixtureName
      }]
    } : {})
  };
}
async function validateBuild(receipt) {
  if (!receipt || receipt.version !== 1 || receipt.status !== 'built' || receipt.exit !== 0 || !/^[a-f0-9]{40}$/.test(receipt.applicationRevision)) fail('GUEST_BUILD_RECEIPT_INVALID');
  await ownedOutput(receipt.outputRoot, {
    fresh: false
  });
  if (resolve(receipt.sourceRoot) !== join(resolve(receipt.outputRoot), 'source')) fail('GUEST_BUILD_RECEIPT_INVALID');
  for (const item of receipt.sourceInputs) await safeFile(receipt.sourceRoot, item.path);
  await safeFile(receipt.outputRoot, 'build-receipt.json');
  const raw = JSON.parse(await readFile(join(receipt.outputRoot, 'build-receipt.json'), 'utf8'));
  if (canonical(raw) !== canonical(receipt)) fail('GUEST_BUILD_RECEIPT_DRIFT');
  for (const item of receipt.sourceInputs) {
    if (typeof item.path !== 'string' || item.path.split('/').some(part => part === '..' || part === '.' || part.includes('\\')) || item.path.startsWith('/')) fail('GUEST_PATH_UNSAFE');
    if (sha256(await readFile(join(receipt.sourceRoot, item.path))) !== item.sha256) fail('GUEST_SOURCE_DRIFT');
  }
  const graph = await inspectGuestHostedModules(join(receipt.sourceRoot, 'dist/server'));
  if (canonical(graph) !== canonical(receipt.graph)) fail('GUEST_MODULE_DRIFT');
  const original = await readFile(join(receipt.sourceRoot, 'wrangler.jsonc'), 'utf8');
  const date = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(original)?.[1];
  const flags = JSON.parse(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/.exec(original)?.[1] ?? 'null');
  return {
    ...receipt,
    compatibility: {
      date,
      flags
    }
  };
}
export async function prepareGuestHostedPackage({
  buildReceipt,
  inventory,
  outputRoot
}) {
  if (typeof buildReceipt === 'string') {
    const receiptDirectory = dirname(resolve(buildReceipt));
    await ownedOutput(receiptDirectory, {
      fresh: false
    });
    if (resolve(buildReceipt) !== join(receiptDirectory, 'build-receipt.json')) fail('GUEST_BUILD_RECEIPT_INVALID');
    await safeFile(receiptDirectory, 'build-receipt.json');
  }
  const identity = validateGuestHostedInventory(inventory, 'offline'),
    output = await ownedOutput(outputRoot),
    receipt = await validateBuild(typeof buildReceipt === 'string' ? JSON.parse(await readFile(buildReceipt, 'utf8')) : buildReceipt);
  await mkdir(output, {
    recursive: true
  });
  const write = async (path, bytes) => {
    await mkdir(dirname(join(output, path)), {
      recursive: true
    });
    await writeFile(join(output, path), bytes, {
      flag: 'wx'
    });
  };
  for (const item of [...receipt.graph.modules, ...receipt.graph.data]) await write('app/server/' + item.path, await readFile(join(receipt.sourceRoot, 'dist/server', item.path)));
  const protocol = guestFixtureProtocol(identity),
    bodies = generateBodies(protocol),
    implementationInputs = [];
  for (const path of implementationFiles) implementationInputs.push({
    path,
    sha256: sha256(await readFile(join(workspaceRoot, path)))
  });
  for (const [source, destination] of runtimeFiles) {
    const bytes = await readFile(join(workspaceRoot, 'scripts/guest-hosted', source));
    if (!implementationInputs.some(input => input.path === 'scripts/guest-hosted/' + source)) implementationInputs.push({
      path: 'scripts/guest-hosted/' + source,
      sha256: sha256(bytes)
    });
    const code = bytes.toString('utf8').replace(/\/\* GUEST_HOSTED_PROTOCOL \*\/\s*null/, canonical(protocol)).replace(/\/\* GUEST_HOSTED_INGRESS \*\/\s*null/, canonical({
      hostname: identity.hostname,
      routes: identity.routes
    }));
    await write(destination, code);
  }
  await write('fixture/data.mjs', `export const scenario=${canonical(protocol)};\nconst raw=${canonical(bodies)};\nexport const bodies=Object.fromEntries(Object.entries(raw).map(([key,body])=>[key,new TextEncoder().encode(body)]));\n`);
  await write('fixture/entry.mjs', "import {handleFixtureRequest} from './worker.mjs';\nimport {scenario,bodies} from './data.mjs';\nexport default {fetch(request,env){return handleFixtureRequest(request,env,scenario,bodies);}};\n");
  await write('fixture/setup.sql', protocol.operations.map(op => `INSERT INTO fixture_operation(run_id,scenario,operation,call_cap) VALUES('${identity.runId}','${identity.scenario}','${op.key}',${op.cap});`).join('\n') + '\n');
  for (const item of receipt.sourceInputs.filter(item => /^migrations\/\d+.*\.sql$/.test(item.path))) await write(item.path, await readFile(join(receipt.sourceRoot, item.path)));
  for (const component of ['candidate', 'fixture']) await write(`wrangler.${component}.json`, JSON.stringify(configuration(identity, receipt, component), null, 2) + '\n');
  await write('build-receipt.json', JSON.stringify(buildReceipt && typeof buildReceipt !== 'string' ? buildReceipt : JSON.parse(await readFile(buildReceipt, 'utf8')), null, 2) + '\n');
  const files = [];
  for (const path of await safeFiles(output)) {
    const bytes = await readFile(join(output, path));
    files.push({
      path,
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
  }
  const manifest = {
    version: 1,
    kind: 'guest-hosted-test-package',
    state: 'prepared-only',
    deployable: false,
    cloudActionAuthorized: false,
    inventory: identity,
    applicationRevision: receipt.applicationRevision,
    buildReceiptSha256: files.find(item => item.path === 'build-receipt.json').sha256,
    sourceInputsSha256: sha256(canonical(receipt.sourceInputs)),
    lockSha256: receipt.lockSha256,
    toolchain: receipt.toolchain,
    environmentKeys: receipt.environment.keys,
    implementationInputs,
    graph: receipt.graph,
    files,
    uploadFiles: files.filter(item => /^(?:app\/server\/|entry\.mjs$|prelude\.mjs$|request-body\.mjs$|fixture\/(?:entry|worker|data|request-body)\.mjs$)/.test(item.path)).map(item => item.path),
    fixtureBodies: Object.entries(bodies).map(([key, body]) => ({
      key,
      bytes: new TextEncoder().encode(body).length,
      sha256: sha256(body)
    })),
    unresolved: identity.accountId === null || identity.appDatabaseId === null || identity.fixtureDatabaseId === null,
    assetPolicy: 'ASSETS is a private rejecting binding to the fixture; zero asset calls must be proved. No client/UI assets uploaded.',
    limitations: ['Trusted-code HTTP fixture substitution; no platform fetch/connect sandbox.', 'Original modules retain filesystem/module/dynamic-code capabilities and one exact reviewed development renderer edge.', 'Durable admissions do not prove delivered bytes.', 'No resource provisioning/upload/provider traffic or cloud authorization.', 'Hosted CPU, peak memory, D1 billing, distributed sources, retention and activation remain unmeasured.']
  };
  const packageDigest = sha256(canonical(manifest));
  manifest.packageDigest = packageDigest;
  const manifestPath = join(output, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx'
  });
  await verifyGuestHostedPackage({
    manifestPath,
    inventory: identity,
    mode: 'offline'
  });
  return {
    manifestPath,
    packageDigest,
    deployable: false
  };
}
export async function verifyGuestHostedPackage({
  manifestPath,
  inventory,
  mode = 'offline'
}) {
  const identity = validateGuestHostedInventory(inventory, mode),
    root = dirname(resolve(manifestPath));
  await ownedOutput(root, {
    fresh: false
  });
  if (resolve(manifestPath) !== join(root, 'manifest.json')) fail('GUEST_MANIFEST_INVALID');
  await safeFile(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')),
    claimed = manifest.packageDigest,
    {
      packageDigest: ignored,
      ...unsigned
    } = manifest;
  void ignored;
  const schema = JSON.parse(await readFile(join(workspaceRoot, 'scripts/guest-hosted/manifest.schema.json'), 'utf8'));
  if (canonical(Object.keys(manifest).sort()) !== canonical(schema.required.slice().sort())) fail('GUEST_MANIFEST_INVALID');
  if (manifest.version !== 1 || manifest.kind !== 'guest-hosted-test-package' || manifest.state !== 'prepared-only' || manifest.deployable !== false || manifest.cloudActionAuthorized !== false || canonical(identity) !== canonical(manifest.inventory) || claimed !== sha256(canonical(unsigned))) fail('GUEST_MANIFEST_DRIFT');
  const actual = await safeFiles(root);
  if (canonical(actual) !== canonical([...manifest.files.map(item => item.path), 'manifest.json'].sort())) fail('GUEST_PACKAGE_FILES_DRIFT');
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || item.path.split('/').some(part => part === '..' || part === '.' || part.includes('\\')) || item.path.startsWith('/')) fail('GUEST_PATH_UNSAFE');
    const bytes = await readFile(join(root, item.path));
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) fail('GUEST_PACKAGE_FILE_DRIFT');
  }
  const expectedUploads = manifest.files.filter(item => /^(?:app\/server\/|entry\.mjs$|prelude\.mjs$|request-body\.mjs$|fixture\/(?:entry|worker|data|request-body)\.mjs$)/.test(item.path)).map(item => item.path);
  if (canonical(manifest.uploadFiles) !== canonical(expectedUploads)) fail('GUEST_UPLOAD_INVENTORY_DRIFT');
  const receipt = JSON.parse(await readFile(join(root, 'build-receipt.json'), 'utf8')),
    verified = await validateBuild(receipt);
  if (manifest.applicationRevision !== receipt.applicationRevision || manifest.sourceInputsSha256 !== sha256(canonical(receipt.sourceInputs)) || manifest.lockSha256 !== receipt.lockSha256 || canonical(manifest.graph) !== canonical(receipt.graph)) fail('GUEST_SOURCE_DRIFT');
  for (const component of ['candidate', 'fixture']) if (canonical(JSON.parse(await readFile(join(root, `wrangler.${component}.json`), 'utf8'))) !== canonical(configuration(identity, verified, component))) fail('GUEST_CONFIG_DRIFT');
  for (const item of [...receipt.graph.modules, ...receipt.graph.data]) if (sha256(await readFile(join(root, 'app/server', item.path))) !== item.sha256) fail('GUEST_MODULE_DRIFT');
  const protocol = guestFixtureProtocol(identity),
    bodies = generateBodies(protocol);
  const expectedGenerated = {
    'fixture/data.mjs': `export const scenario=${canonical(protocol)};\nconst raw=${canonical(bodies)};\nexport const bodies=Object.fromEntries(Object.entries(raw).map(([key,body])=>[key,new TextEncoder().encode(body)]));\n`,
    'fixture/entry.mjs': "import {handleFixtureRequest} from './worker.mjs';\nimport {scenario,bodies} from './data.mjs';\nexport default {fetch(request,env){return handleFixtureRequest(request,env,scenario,bodies);}};\n",
    'fixture/setup.sql': protocol.operations.map(op => `INSERT INTO fixture_operation(run_id,scenario,operation,call_cap) VALUES('${identity.runId}','${identity.scenario}','${op.key}',${op.cap});`).join('\n') + '\n'
  };
  for (const [source, destination] of runtimeFiles) {
    const raw = await readFile(join(workspaceRoot, 'scripts/guest-hosted', source), 'utf8');
    expectedGenerated[destination] = raw.replace(/\/\* GUEST_HOSTED_PROTOCOL \*\/\s*null/, canonical(protocol)).replace(/\/\* GUEST_HOSTED_INGRESS \*\/\s*null/, canonical({
      hostname: identity.hostname,
      routes: identity.routes
    }));
  }
  for (const [path, expected] of Object.entries(expectedGenerated)) if (sha256(await readFile(join(root, path))) !== sha256(expected)) fail('GUEST_GENERATED_FILE_DRIFT');
  const migrations = receipt.sourceInputs.filter(item => /^migrations\/\d+.*\.sql$/.test(item.path));
  for (const item of migrations) if (sha256(await readFile(join(root, item.path))) !== item.sha256) fail('GUEST_SOURCE_DRIFT');
  const expectedFiles = [...receipt.graph.modules, ...receipt.graph.data].map(item => 'app/server/' + item.path).concat(Object.keys(expectedGenerated), migrations.map(item => item.path), ['wrangler.candidate.json', 'wrangler.fixture.json', 'build-receipt.json']).sort();
  if (canonical(expectedFiles) !== canonical(manifest.files.map(item => item.path).sort())) fail('GUEST_PACKAGE_FILES_DRIFT');
  const expectedInputs = [];
  for (const path of new Set(implementationFiles.concat(runtimeFiles.map(([source]) => 'scripts/guest-hosted/' + source)))) expectedInputs.push({
    path,
    sha256: sha256(await readFile(join(workspaceRoot, path)))
  });
  if (canonical(manifest.implementationInputs) !== canonical(expectedInputs)) fail('GUEST_IMPLEMENTATION_DRIFT');
  const expectedBodies = Object.entries(bodies).map(([key, body]) => ({
    key,
    bytes: new TextEncoder().encode(body).length,
    sha256: sha256(body)
  }));
  if (canonical(expectedBodies) !== canonical(manifest.fixtureBodies) || manifest.unresolved !== ['accountId', 'appDatabaseId', 'fixtureDatabaseId'].some(key => identity[key] === null) || manifest.buildReceiptSha256 !== sha256(await readFile(join(root, 'build-receipt.json'))) || canonical(manifest.environmentKeys) !== canonical(receipt.environment.keys) || canonical(manifest.toolchain) !== canonical(receipt.toolchain)) fail('GUEST_MANIFEST_DRIFT');
  for (const input of manifest.implementationInputs) if (sha256(await readFile(join(workspaceRoot, input.path))) !== input.sha256) fail('GUEST_IMPLEMENTATION_DRIFT');
  return {
    manifestPath: resolve(manifestPath),
    packageDigest: claimed,
    deployable: false,
    cloudActionAuthorized: false,
    mode,
    manifest
  };
}
