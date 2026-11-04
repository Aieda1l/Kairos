import type {D1DatabaseLike} from '../../src/lib/db/d1/types';
import type {maintainAbuseState} from './abuse-maintenance.mjs';

type Counts = Awaited<ReturnType<typeof maintainAbuseState>>;
type SnapshotProof = Record<string, {
  beforeRows: number;
  afterRows: number;
  beforeSha256: string;
  expectedSha256: string;
  afterSha256: string;
}>;
type Invocation = {counts: Counts; elapsedMs: number; snapshots: SnapshotProof};
export interface GuestRetentionReceipt {
  code: 'GUEST_RETENTION_VALIDATED';
  batchSize: number;
  maximumDrainInvocations: number;
  expiredAnonymousBefore: number;
  expiredAnonymousAfter: number;
  expiredRateRowsAfter: number;
  dryRun: Invocation;
  applies: Invocation[];
  finalApply: Invocation;
  snapshots: SnapshotProof;
  outboundAttempts: number;
}
export function sha256(value: string | Uint8Array): string;
export function runGuestRetentionValidation(options: {
  open: () => Promise<{
    db: D1DatabaseLike;
    dispose: () => Promise<void>;
    outboundAttempts: () => Promise<number>;
  }>;
  writeReceipt: (receipt: GuestRetentionReceipt) => Promise<void>;
  diagnostic: (message: string) => void;
  maintain?: typeof maintainAbuseState;
}): Promise<0 | 1>;
