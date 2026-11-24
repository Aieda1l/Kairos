import type { CronMetricCode } from './lib/maintenance-cron-monitor.mjs';

export function checkMaintenanceCron(options?: {
  env?: Record<string, string | undefined>;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  code: CronMetricCode | 'CRON_MONITOR_CONFIG_INVALID' | 'CRON_WINDOW_EXPIRED';
  dueTicks?: number;
  fromUtc?: string;
  throughUtc?: string;
}>;
