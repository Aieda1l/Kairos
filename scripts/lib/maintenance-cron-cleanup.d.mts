import type { D1DatabaseLike } from '../../src/lib/db/d1/types';

type CleanupCounts = {
  rateEvents: number;
  runs: number;
  oauthRequests: number;
  bridgeRequests: number;
};

export const cleanupCron: '17 * * * *';
export const cleanupControlSchema: string;

export function runMaintenanceCronCleanup(options: {
  controller: { cron: string; scheduledTime: number };
  env: {
    KAIROS_CRON_CLEANUP_MODE?: string;
    DB?: Pick<D1DatabaseLike, 'prepare'>;
    OPERATIONS?: Pick<D1DatabaseLike, 'prepare'>;
  };
  nowMs?: number;
}): Promise<
  | { status: 'off' | 'invalid-trigger' | 'not-admitted' }
  | { status: 'dry-run' | 'applied'; tickMs: number; counts: CleanupCounts }
>;
