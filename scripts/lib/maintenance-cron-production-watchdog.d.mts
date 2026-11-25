import type { D1DatabaseLike } from '../../src/lib/db/d1/types';

export const productionWatchdogSchema: string;

export type ProductionCronWatchdogContext = {
  operations: Pick<D1DatabaseLike, 'prepare'>;
  activationMs: number;
  observedAtMs: number;
  ticks: ReadonlyArray<{ tickMs: number; status: 'success' | 'failure' | 'missing' }>;
  completion: { last_tick_ms: number; state: 'idle' | 'running' | 'success' | 'failure' } | null;
  sendAlert: (details: { failedTicks: number; missingTicks: number; fromUtc: string; throughUtc: string; recovered?: true }) => Promise<unknown>;
};

export function runProductionCronWatchdog(options: ProductionCronWatchdogContext): Promise<{
  code: 'CRON_FAILED' | 'CRON_FAILED_RECOVERED' | 'CRON_OVERDUE' | 'CRON_OK' | 'CRON_MISSING_PENDING' | 'CRON_METRICS_UNAVAILABLE'
    | 'CRON_CLEANUP_RECEIPT_UNAVAILABLE' | 'CRON_WATCHDOG_INACTIVE' | 'CRON_WATCHDOG_ALREADY_OBSERVED'
    | 'CRON_WATCHDOG_STATE_UNAVAILABLE';
  dispatch: 'none' | 'suppressed' | 'accepted' | 'unconfirmed';
}>;
