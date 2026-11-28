export type CronMetricCode = 'CRON_OK' | 'CRON_NOT_DUE' | 'CRON_FAILED' | 'CRON_OVERDUE' | 'CRON_METRICS_UNAVAILABLE';

export function parseUtcMinute(value: unknown): number;

interface CronMetricOptions {
  worker: string;
  expectedTicks: readonly number[];
  nowMs: number;
  graceMs: number;
  limit: number;
}

export type CronMetricSummary =
  | { code: 'CRON_NOT_DUE' | 'CRON_METRICS_UNAVAILABLE' }
  | { code: 'CRON_OK' | 'CRON_FAILED' | 'CRON_OVERDUE'; failedTicks: number; missingTicks: number };

export function classifyCronMetrics(payload: unknown, options: CronMetricOptions): { code: CronMetricCode };
export function summarizeCronMetrics(payload: unknown, options: CronMetricOptions): CronMetricSummary;

export interface HourlyCronTick {
  tickMs: number;
  status: 'success' | 'failure' | 'missing';
}

export type HourlyCronMetricSummary = CronMetricSummary & { ticks?: HourlyCronTick[] };

export const hourlyInvocationLagMinutes: number;
export function summarizeHourlyCronMetrics(payload: unknown, options: CronMetricOptions): HourlyCronMetricSummary;
