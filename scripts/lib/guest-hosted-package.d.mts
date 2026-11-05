import type { BuildReceipt } from './guest-hosted-build.mjs';
export type GuestHostedInventory = {
  version: number;
  runId: string;
  scenario: string;
  hostname: string;
  candidateName: string;
  fixtureName: string;
  appDatabaseName: string;
  fixtureDatabaseName: string;
  accountId: string | null;
  appDatabaseId: string | null;
  fixtureDatabaseId: string | null;
  [key: string]: unknown;
};
export const GUEST_ROUTES: readonly {
  method: string;
  path: string;
}[];
export const GUEST_LIMITS: Readonly<{
  appRequests: number;
  concurrent: number;
  requestTimeoutMs: number;
  dispatchDeadlineMs: number;
  fixtureAdmissions: number;
  retries: number;
  redirects: number;
}>;
export const CANDIDATE_SECRET_NAMES: readonly string[];
export const FIXTURE_SECRET_NAMES: readonly string[];
export function guestFixtureProtocol(identity: GuestHostedInventory): {
  version: number;
  runId: string;
  scenario: string;
  hostname: string;
  operations: Record<string, unknown>[];
};
export function validateGuestHostedInventory(input: unknown, mode?: 'offline' | 'operator-ready'): GuestHostedInventory;
export function prepareGuestHostedPackage(options: {
  buildReceipt: BuildReceipt | string;
  inventory: GuestHostedInventory;
  outputRoot: string;
}): Promise<{
  manifestPath: string;
  packageDigest: string;
  deployable: false;
}>;
export function verifyGuestHostedPackage(options: {
  manifestPath: string;
  inventory: GuestHostedInventory;
  mode?: 'offline' | 'operator-ready';
}): Promise<{
  manifestPath: string;
  packageDigest: string;
  deployable: false;
  cloudActionAuthorized: false;
  mode: string;
  manifest: Record<string, unknown>;
}>;
