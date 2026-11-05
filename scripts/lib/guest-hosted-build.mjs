// Offline-only original-source builder. No Wrangler CLI, credentials or deployment adapter.
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
export const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const fail = code => {
  throw new Error(code);
};
const envName = name => /^\.(?:env|dev\.vars)/i.test(name);
export async function ownedOutput(path, {
  fresh = true
} = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('GUEST_OUTPUT_UNOWNED');
  const base = resolve(workspaceRoot, 'artifacts/guest-hosted'),
    target = resolve(path),
    rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('GUEST_OUTPUT_UNOWNED');
  let current = workspaceRoot;
  for (const part of relative(workspaceRoot, target).split(sep)) {
    current = join(current, part);
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink() || !s.isDirectory()) fail('GUEST_PATH_UNSAFE');
      if (current === target && fresh) fail('GUEST_OUTPUT_EXISTS');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}
export async function safeFiles(root) {
  // Check every owned ancestor before readdir/readFile can traverse generated output.
  // In particular, a normal server directory beneath a junctioned dist is unsafe.
  await ownedOutput(resolve(root), {
    fresh: false
  });
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, {
      withFileTypes: true
    })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name),
        s = await lstat(path);
      if (s.isSymbolicLink() || !s.isDirectory() && !s.isFile()) fail('GUEST_PATH_UNSAFE');
      if (envName(entry.name)) fail('GUEST_BUILD_ENV_OUTPUT');
      if (s.isDirectory()) await walk(path);else files.push(relative(root, path).split(sep).join('/'));
    }
  }
  if ((await lstat(root)).isSymbolicLink()) fail('GUEST_PATH_UNSAFE');
  await walk(root);
  return files.sort();
}
export function sanitizedBuildEnvironment(stateDirectory) {
  const env = {};
  // Values are OS/runtime paths only. Never inherit application/public or credential keys.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    TEMP: join(stateDirectory, 'tmp'),
    TMP: join(stateDirectory, 'tmp'),
    TMPDIR: join(stateDirectory, 'tmp'),
    XDG_CONFIG_HOME: join(stateDirectory, 'config'),
    XDG_CACHE_HOME: join(stateDirectory, 'cache'),
    XDG_DATA_HOME: join(stateDirectory, 'data'),
    NODE_ENV: 'production',
    CI: 'true',
    NO_COLOR: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    CLOUDFLARE_VITE_FORCE_LOCAL: 'true',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false'
  };
}
const externals = new Set(['cloudflare:workers', 'node:async_hooks', 'node:buffer', 'node:crypto', 'node:fs', 'node:module', 'node:path', 'node:url']);
function walkAst(node, visit, parents = []) {
  if (!node || typeof node !== 'object') return;
  visit(node, parents);
  for (const [key, item] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(item)) for (const child of item) walkAst(child, visit, [...parents, node]);else if (item && typeof item === 'object') walkAst(item, visit, [...parents, node]);
  }
}
export async function inspectGuestHostedModules(root) {
  const all = await safeFiles(root),
    modules = [],
    data = [],
    edges = [],
    computed = [];
  for (const path of all) {
    // Generated config is never an upload input. Only JS and reviewed runtime data are retained.
    if (['wrangler.json', '.vite/manifest.json', 'BUILD_ID', 'RSC_BUILD_ID', 'vinext-server.json', 'vinext-externals.json'].includes(path)) continue;
    if (path.endsWith('.map')) continue;
    if (!/\.(?:js|mjs|json|css)$/.test(path)) fail('GUEST_MODULE_UNSUPPORTED');
    const bytes = await readFile(join(root, path)),
      identity = {
        path,
        sha256: sha256(bytes),
        bytes: bytes.length
      };
    if (path.endsWith('.json') || path.endsWith('.css')) {
      data.push(identity);
      continue;
    }
    let ast;
    try {
      ast = parse(bytes.toString('utf8'), {
        sourceType: 'module',
        createImportExpressions: true
      });
    } catch {
      fail('GUEST_MODULE_UNSUPPORTED');
    }
    const imports = [];
    walkAst(ast, (node, parents) => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) imports.push(node.source.value);
      if (node.type === 'ImportExpression') {
        if (node.source.type === 'StringLiteral') imports.push(node.source.value);else if (node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0) imports.push(node.source.quasis[0].value.cooked);else {
          const owner = parents.findLast(parent => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type));
          computed.push({
            path,
            start: node.start,
            end: node.end,
            expressionSha256: sha256(bytes.toString('utf8').slice(node.start, node.end)),
            moduleSha256: identity.sha256,
            ownerSha256: owner ? sha256(bytes.toString('utf8').slice(owner.start, owner.end)) : null,
            referencedBindings: path === 'ssr/index.js' ? ast.program.body.filter((node, index) => index < 2 || node.type === 'FunctionDeclaration' && node.id.name === 'Ii').map(node => ({
              type: node.type,
              sha256: sha256(bytes.toString('utf8').slice(node.start, node.end))
            })) : []
          });
        }
      }
      // No arbitrary native loader exemption; require/eval edges must be reviewed explicitly.
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && ['require', 'eval'].includes(node.callee.name)) fail('GUEST_MODULE_UNSUPPORTED');
      if (node.type === 'CallExpression' && node.callee?.name === 'Function' && !(sha256(bytes.toString('utf8').slice(node.start, node.end)) === '91ff2a64c35288a5b52e2c1fe67ce53b64d246ac5a4382f0849d91b866b83923' && ['b3c068af09904fae0b69e3f5a65ee3c1eb485b1c74fd39f7a6886ccc6cc9eb56', 'd942c31d0c6020df0284f30ece54581e7c70c85287a880c0ee0240d392e88176'].includes(identity.sha256))) fail('GUEST_MODULE_UNSUPPORTED');
    });
    for (const specifier of imports) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        if (target.startsWith('../') || !all.includes(target)) fail('GUEST_MODULE_UNRESOLVED');
        edges.push({
          from: path,
          to: target,
          kind: 'module'
        });
      } else {
        if (!externals.has(specifier)) fail('GUEST_MODULE_UNSUPPORTED');
        edges.push({
          from: path,
          to: specifier,
          kind: 'external'
        });
      }
    }
    modules.push(identity);
  }
  const reviewed = {
    path: 'ssr/index.js',
    ownerSha256: '2b1d450a77d98eda572b804df8f68c16b0945a61c98a8e8dd163df1f9ddbd083',
    expressionSha256: 'b4a784718595ed2244c2ee4feed4bab62ff4c9369365286b13b1d3098183bb97',
    referencedBindings: [{
      type: 'ImportDeclaration',
      sha256: '9c8700d47f8cf05e669d2cc376cb02de8eee70b9359ab979d294a0ef02f3477d'
    }, {
      type: 'VariableDeclaration',
      sha256: 'baab798f1f96ae4482912aae64003f576bed017a07c5d52dae866b3f4ddafa71'
    }, {
      type: 'FunctionDeclaration',
      sha256: '4e78dbf36282cb61212898423e4b379834c5236d68c5f4d08ee21581516b573e'
    }],
    bindingProvenance: 'Pinned node:url namespace import and import.meta URL shim bind the module URL supplied to createRequire.resolve; pinned development gate compiles to false. API proof does not exercise this renderer loader.',
    dependencySource: 'node_modules/vinext/dist/server/app-ssr-entry.js',
    dependencySourceSha256: 'db1e1d348fe418da332d940e13ab8d6c07ab78600b579f00430350cd40365470',
    reason: 'Exact Vinext development static-prerender fallback: createRequire.resolve react-dom/package.json then import path.join(dir,cjs/react-dom-server.edge.development.js). Retained unchanged; not exercised by API-only proof and not a closed capability sandbox.'
  };
  for (const edge of computed) {
    if (['path', 'ownerSha256', 'expressionSha256'].some(key => edge[key] !== reviewed[key]) || canonical(edge.referencedBindings) !== canonical(reviewed.referencedBindings)) fail('GUEST_MODULE_UNSUPPORTED');
    if (sha256(await readFile(join(workspaceRoot, reviewed.dependencySource))) !== reviewed.dependencySourceSha256) fail('GUEST_MODULE_UNSUPPORTED');
  }
  for (const dependency of [{
    path: 'node_modules/zod/v4/core/util.js',
    sha256: '728f52b496620336775eafcdb91c0a574380086e53f215b55c58eedc1422c49c'
  }, {
    path: 'node_modules/zod/v4/core/doc.js',
    sha256: 'be4c1b1a1ad247cc70f360a572060edd7e0cea24252c3a319f33d247899c5643'
  }]) {
    if (modules.some(module => ['b3c068af09904fae0b69e3f5a65ee3c1eb485b1c74fd39f7a6886ccc6cc9eb56', 'd942c31d0c6020df0284f30ece54581e7c70c85287a880c0ee0240d392e88176'].includes(module.sha256)) && sha256(await readFile(join(workspaceRoot, dependency.path))) !== dependency.sha256) fail('GUEST_MODULE_UNSUPPORTED');
  }
  const reachable = new Set(['index.js']),
    pending = ['index.js'];
  while (pending.length) {
    const from = pending.pop();
    for (const edge of edges.filter(edge => edge.from === from && edge.kind === 'module')) if (!reachable.has(edge.to)) {
      reachable.add(edge.to);
      pending.push(edge.to);
    }
  }
  const retainedModules = modules.filter(module => reachable.has(module.path)),
    retainedData = data.filter(item => reachable.has(item.path));
  const entry = parse((await readFile(join(root, 'index.js'))).toString('utf8'), {
    sourceType: 'module'
  });
  if (!entry.program.body.some(node => node.type === 'ExportDefaultDeclaration' || node.type === 'ExportNamedDeclaration' && node.specifiers.some(spec => spec.exported?.name === 'default'))) fail('GUEST_MODULE_UNSUPPORTED');
  if (!modules.some(module => module.path === 'index.js')) fail('GUEST_MODULE_UNRESOLVED');
  return {
    modules: retainedModules,
    data: retainedData,
    edges: edges.filter(edge => reachable.has(edge.from)),
    computedExceptions: computed.map(edge => ({
      ...reviewed,
      ...edge,
      offsetUnit: 'UTF16-source-code-units'
    })),
    dynamicCodeCapabilities: modules.filter(module => ['b3c068af09904fae0b69e3f5a65ee3c1eb485b1c74fd39f7a6886ccc6cc9eb56', 'd942c31d0c6020df0284f30ece54581e7c70c85287a880c0ee0240d392e88176'].includes(module.sha256)).map(module => ({
      ...module,
      reason: 'Pinned Zod Function capability probe and aliased JIT compiler. workerd disables dynamic code; no platform sandbox claim.',
      dependencySources: [{
        path: 'node_modules/zod/v4/core/util.js',
        sha256: '728f52b496620336775eafcdb91c0a574380086e53f215b55c58eedc1422c49c'
      }, {
        path: 'node_modules/zod/v4/core/doc.js',
        sha256: 'be4c1b1a1ad247cc70f360a572060edd7e0cea24252c3a319f33d247899c5643'
      }]
    })),
    externalCapabilities: [...new Set(edges.filter(edge => edge.kind === 'external').map(edge => edge.to))].sort(),
    limitations: ['Trusted-code transport substitution; no platform fetch/connect sandbox.', 'Retained node:fs and node:module capabilities are not eliminated by route allowlisting.']
  };
}
async function execute(file, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      ...options,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const chunks = {
      stdout: [],
      stderr: []
    };
    for (const key of ['stdout', 'stderr']) child[key].on('data', data => chunks[key].push(data));
    child.on('error', reject);
    child.on('close', code => resolvePromise({
      code,
      stdout: Buffer.concat(chunks.stdout),
      stderr: Buffer.concat(chunks.stderr)
    }));
    child.stdin.end(options.input);
  });
}
export async function buildGuestHostedApplication({
  applicationRevision,
  outputRoot
}) {
  if (typeof applicationRevision !== 'string' || !/^[a-f0-9]{40}$/.test(applicationRevision)) fail('GUEST_BUILD_IDENTITY_INVALID');
  const output = await ownedOutput(outputRoot);
  const git = (...args) => execFileSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    windowsHide: true
  }).trim();
  if (git('rev-parse', applicationRevision + '^{commit}') !== applicationRevision) fail('GUEST_BUILD_IDENTITY_INVALID');
  await mkdir(output, {
    recursive: true
  });
  const sourceRoot = join(output, 'source'),
    stateRoot = join(output, 'state');
  await mkdir(sourceRoot);
  for (const dir of ['tmp', 'config', 'cache', 'data']) await mkdir(join(stateRoot, dir), {
    recursive: true
  });
  const tree = execFileSync('git', ['ls-tree', '-rz', '--full-tree', applicationRevision], {
    cwd: workspaceRoot,
    windowsHide: true
  }).toString('utf8').split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match) fail('GUEST_SOURCE_UNSUPPORTED');
    return {
      mode: match[1],
      oid: match[2],
      path: match[3]
    };
  });
  const selected = [];
  const excluded = [];
  for (const item of tree) {
    if (item.mode !== '100644' && item.mode !== '100755') fail('GUEST_PATH_UNSAFE');
    if (item.path.split('/').some(part => part === '..' || part === '.' || part.includes('\\')) || isAbsolute(item.path)) fail('GUEST_PATH_UNSAFE');
    if (item.path.split('/').some(envName) || /^(?:dist|node_modules|\.wrangler|artifacts|\.next)\//.test(item.path)) {
      excluded.push(item.path);
      continue;
    }
    selected.push(item);
  }
  const blobs = await execute('git', ['cat-file', '--batch'], {
    cwd: workspaceRoot,
    input: selected.map(item => item.oid + '\n').join('')
  });
  if (blobs.code !== 0) fail('GUEST_SOURCE_EXPORT_FAILED');
  let offset = 0;
  const inputs = [];
  for (const item of selected) {
    const end = blobs.stdout.indexOf(10, offset),
      header = blobs.stdout.subarray(offset, end).toString('utf8'),
      match = /^([a-f0-9]{40}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== item.oid) fail('GUEST_SOURCE_EXPORT_FAILED');
    const length = Number(match[2]),
      bytes = blobs.stdout.subarray(end + 1, end + 1 + length);
    offset = end + length + 2;
    const path = join(sourceRoot, item.path);
    await mkdir(dirname(path), {
      recursive: true
    });
    await writeFile(path, bytes, {
      flag: 'wx'
    });
    inputs.push({
      path: item.path,
      sha256: sha256(bytes),
      bytes: length,
      gitBlob: item.oid
    });
  }
  const sourceLock = inputs.find(item => item.path === 'package-lock.json');
  if (!sourceLock || sourceLock.sha256 !== sha256(await readFile(join(workspaceRoot, 'package-lock.json')))) fail('GUEST_DEPENDENCIES_DRIFT');
  const lock = JSON.parse(await readFile(join(sourceRoot, 'package-lock.json'), 'utf8')),
    dependencyRoot = await realpath(join(workspaceRoot, 'node_modules')),
    installed = [];
  for (const [path, info] of Object.entries(lock.packages)) {
    if (!path || !path.startsWith('node_modules/') || info.link) continue;
    try {
      const raw = await readFile(join(workspaceRoot, path, 'package.json'));
      const actual = JSON.parse(raw);
      if (actual.version !== info.version) fail('GUEST_DEPENDENCIES_DRIFT');
      installed.push({
        path,
        version: actual.version,
        packageJsonSha256: sha256(raw),
        integrity: info.integrity ?? null
      });
    } catch (error) {
      if (error.code === 'ENOENT' && info.optional) continue;
      throw error;
    }
  }
  await symlink(dependencyRoot, join(sourceRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const env = sanitizedBuildEnvironment(stateRoot),
    command = [process.execPath, join(dependencyRoot, 'vite/bin/vite.js'), 'build'];
  const result = await execute(command[0], command.slice(1), {
    cwd: sourceRoot,
    env
  });
  await writeFile(join(output, 'build.stdout.log'), result.stdout);
  await writeFile(join(output, 'build.stderr.log'), result.stderr);
  await writeFile(join(output, 'build.exit.json'), JSON.stringify({
    exit: result.code
  }));
  if (result.code !== 0) fail('GUEST_BUILD_FAILED');
  // Scan all dist names before opening any emitted file; private environment emission is fatal.
  const emitted = await safeFiles(join(sourceRoot, 'dist'));
  const receipt = {
    version: 1,
    applicationRevision,
    sourceRoot,
    outputRoot: output,
    buildCommand: ['node', 'node_modules/vite/bin/vite.js', 'build'],
    buildMode: 'production',
    exit: result.code,
    sourceInputs: inputs,
    excludedEnvironmentPaths: excluded,
    configInputs: inputs.filter(item => ['vite.config.ts', 'next.config.ts', 'tsconfig.json', 'wrangler.jsonc', 'package.json', 'package-lock.json'].includes(item.path)),
    lockSha256: sourceLock.sha256,
    dependencyRoot,
    dependencyInventorySha256: sha256(canonical(installed)),
    toolchain: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      packages: installed.filter(item => ['node_modules/vite', 'node_modules/vinext', 'node_modules/wrangler', 'node_modules/miniflare', 'node_modules/@cloudflare/vite-plugin', 'node_modules/@babel/parser'].includes(item.path))
    },
    environment: {
      keys: Object.keys(env).sort(),
      controls: Object.fromEntries(Object.entries(env).filter(([key]) => !['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'].includes(key)))
    },
    emittedInventory: emitted,
    clientAssets: [],
    status: 'graph-pending'
  };
  const receiptPath = join(output, 'build-receipt.json');
  // Retain sanitized provenance even when an original module edge cannot be supported.
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx'
  });
  const graph = await inspectGuestHostedModules(join(sourceRoot, 'dist/server'));
  for (const path of emitted.filter(path => path.startsWith('client/'))) {
    if (!['client/.assetsignore', 'client/_headers'].includes(path) && !/\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|json|txt|html)$/.test(path)) fail('GUEST_ASSET_UNSUPPORTED');
    const bytes = await readFile(join(sourceRoot, 'dist', path));
    receipt.clientAssets.push({
      kind: ['client/.assetsignore', 'client/_headers'].includes(path) ? 'build-metadata' : 'asset',
      path,
      bytes: bytes.length,
      sha256: sha256(bytes)
    });
  }
  Object.assign(receipt, {
    status: 'built',
    graph,
    receiptPath
  });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
