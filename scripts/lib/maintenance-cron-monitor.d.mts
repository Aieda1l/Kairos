export type CronMetricCode = 'CRON_OK' | 'CRON_NOT_DUE' | 'CRON_FAILED' | 'CRON_OVERDUE' | 'CRON_METRICS_UNAVAILABLE';

export function parseUtcMinute(value: unknown): number;

export function classifyCronMetrics(payload: unknown, options: {
  worker: string;
  expectedTicks: readonly number[];
  nowMs: number;
  graceMs: number;
  limit: number;
}): { code: CronMetricCode };
