import type { CronMetricSummary, HourlyCronTick } from './maintenance-cron-monitor.mjs';

export type CronObservationResult = (
  | CronMetricSummary
  | { code: 'CRON_MONITOR_CONFIG_INVALID' | 'CRON_WINDOW_EXPIRED' }
) & {
  dueTicks?: number;
  fromUtc?: string;
  throughUtc?: string;
};

interface CronObservationOptions {
  env: Record<string, string | undefined>;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}

export type HourlyCronObservationResult = CronObservationResult & { ticks?: HourlyCronTick[] };

export function observeMaintenanceCron(options: CronObservationOptions): Promise<CronObservationResult>;
export function observeHourlyMaintenanceCron(options: CronObservationOptions): Promise<HourlyCronObservationResult>;
