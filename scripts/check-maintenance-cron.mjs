import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { observeMaintenanceCron } from './lib/maintenance-cron-observation.mjs';

export async function checkMaintenanceCron({ env = process.env, nowMs, fetchImpl } = {}) {
  const result = await observeMaintenanceCron({ env, nowMs, fetchImpl });
  const { code, dueTicks, fromUtc, throughUtc } = result;
  return dueTicks === undefined ? { code } : { code, dueTicks, fromUtc, throughUtc };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await checkMaintenanceCron();
  console.log(JSON.stringify(result));
  process.exitCode = ['CRON_OK', 'CRON_NOT_DUE', 'CRON_WINDOW_EXPIRED'].includes(result.code) ? 0 : 1;
}
