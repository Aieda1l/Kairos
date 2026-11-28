import type { CronObservationResult } from './maintenance-cron-observation.mjs';
import type { D1DatabaseLike } from '../../src/lib/db/d1/types';

export const watchdogStateSchema: string;

export function runMaintenanceCronWatchdog(options: {
  db: Pick<D1DatabaseLike, 'prepare'>;
  observedAtMs: number;
  observation: CronObservationResult;
  sendAlert: (alert: {failedTicks: number; missingTicks: number; fromUtc: string; throughUtc: string}) => Promise<unknown>;
}): Promise<{
  code: CronObservationResult['code'] | 'CRON_WATCHDOG_STATE_UNAVAILABLE';
  dispatch: 'none' | 'accepted' | 'unconfirmed' | 'suppressed';
}>;
