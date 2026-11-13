// Process CPU for the portable parser in a Node-simulated client.
// This cannot measure deployed Worker CPU or per-isolate memory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {canvasBody, edBody, emptyServerOnly, fixtureRequestId, fixtureCheckedAt, sourceIdentity} from '../tests/helpers/guest-workerd-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'artifacts/guest-source-capacity', `${new Date().toISOString().replace(/[:.]/g, '-')}-node`);
await mkdir(directory, {recursive: true});
const report = {code: 'GUEST_LOCAL_PARSER_MEASUREMENTS_FAILED', evidenceType: 'node-simulated-client-process-cpu',
  nodeVersion: process.version, platform: process.platform, architecture: process.arch, concurrency: 1,
  externalRequests: 0, unexpectedGlobalFetchAttempts: 0, d1: {statements: 0, reads: 0, writes: 0, reason: 'Source pipeline only; admission measured separately in native script.'},
  productionWorkerCpuMs: null, productionIsolateMemoryBytes: null, results: []};
const started = performance.now();
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { report.unexpectedGlobalFetchAttempts++; throw new Error('Unexpected network fetch in local measurement'); };
try {
  const built = await build({stdin: {contents: `export {parseGuestSourceBytes} from './src/lib/guest/sources/parse';`,
    resolveDir: root, sourcefile: 'guest-node-measurement.ts', loader: 'ts'}, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [emptyServerOnly]});
  const moduleFile = join(directory, 'pipeline.mjs');
  await writeFile(moduleFile, built.outputFiles[0].text, 'utf8');
  const readers = await import(pathToFileURL(moduleFile).href);
  report.source = await sourceIdentity(root, ['scripts/measure-guest-source-parsers.mjs', 'tests/helpers/guest-workerd-fixtures.mjs']);
  const fixtures = [
    {name: 'canvas-2000-assignments-near-byte-cap', kind: 'canvas', body: canvasBody(2000, true), inputCount: 2000, expectedCount: 2000},
    {name: 'canvas-5000-ordinary-events', kind: 'canvas', body: canvasBody(5000).replaceAll('event-assignment-', 'event-calendar-'), inputCount: 5000, expectedCount: 0},
    {name: 'ed-500-courses-near-byte-cap', kind: 'courses', body: edBody('courses', 500, true), inputCount: 500, expectedCount: 500},
    {name: 'ed-2000-raw-1000-visible-lessons-near-byte-cap', kind: 'lessons', body: edBody('lessons', 2000, true), inputCount: 2000, expectedCount: 1000},
  ];
  for (const fixture of fixtures) {
    const bytes = new TextEncoder().encode(fixture.body);
    const samples = [];
    const input = {operation: fixture.kind === 'canvas' ? 'canvas-feed' : fixture.kind === 'courses' ? 'ed-courses' : 'ed-lessons', requestId: fixtureRequestId, checkedAt: fixtureCheckedAt, bytes: bytes.buffer, ...(fixture.kind === 'lessons' ? {courseId: '12'} : {})};
    // One warmup, five measured iterations. Fixture generation/bundling excluded.
    for (let iteration = -1; iteration < 5; iteration++) {
      const cpuBefore = process.cpuUsage(), wallBefore = performance.now(), rssBefore = process.memoryUsage().rss;
      const result = await readers.parseGuestSourceBytes(input);
      const elapsedMs = performance.now() - wallBefore, cpu = process.cpuUsage(cpuBefore), rssAfter = process.memoryUsage().rss;
      const count = (result.assignments ?? result.courses ?? result.lessons).length;
      assert.equal(count, fixture.expectedCount);
      if (iteration >= 0) samples.push({elapsedMs, processCpuUserMs: cpu.user / 1000, processCpuSystemMs: cpu.system / 1000,
        processCpuTotalMs: (cpu.user + cpu.system) / 1000, processRssBeforeBytes: rssBefore, processRssAfterBytes: rssAfter,
        outputBytes: Buffer.byteLength(JSON.stringify(result)), outputCount: count, fixtureFetches: 0});
    }
    report.results.push({name: fixture.name, ok: true, fixtureBytes: bytes.byteLength, fixtureSha256: createHash('sha256').update(bytes).digest('hex'), inputCount: fixture.inputCount, warmupIterations: 1, measuredIterations: 5, samples});
  }
  assert.equal(report.unexpectedGlobalFetchAttempts, 0);
  report.code = 'GUEST_LOCAL_PARSER_MEASUREMENTS';
} catch (error) {
  report.failure = {kind: error instanceof assert.AssertionError ? 'assertion' : error?.name ?? 'Error'};
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  report.elapsedMs = performance.now() - started;
  report.limitations = 'Node simulated-client process CPU includes byte decoding, parsing, normalization and schema validation; it excludes network and approval; RSS is shared process memory, not a peak or deployed isolate measurement. No hosted CPU, capacity, retention or live acceptance gate is closed.';
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({...report, source: report.source ? {ref: report.source.ref, dirty: report.source.dirty} : null, receipt: join(directory, 'receipt.json')}));
}
