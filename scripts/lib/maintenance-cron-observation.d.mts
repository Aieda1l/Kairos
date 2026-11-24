import type { CronMetricSummary } from './maintenance-cron-monitor.mjs';

export type CronObservationResult = (
  | CronMetricSummary
  | { code: 'CRON_MONITOR_CONFIG_INVALID' | 'CRON_WINDOW_EXPIRED' }
) & {
  dueTicks?: number;
  fromUtc?: string;
  throughUtc?: string;
};

export function observeMaintenanceCron(options: {
  env: Record<string, string | undefined>;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<CronObservationResult>;
