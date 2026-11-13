import type { DiagnosticWorkloadItem } from './guest-hosted-diagnostic.mjs';
export function parseNativeProofArguments(args: string[]): { manifestPath: string; inventoryPath: string; expectedDigest: string; evidenceRoot: string };
export function parseGuestHostedArguments(args: string[]): { mode: 'prepare'; buildReceiptPath: string; inventoryPath: string; outputRoot: string } | { mode: 'verify-prepared'; manifestPath: string; inventoryPath: string; expectedDigest: string } | { mode: 'hosted'; operatorInputPath: string; expectedDigest: string; evidenceRoot: string };
export function readGuestHostedJson(path: string, maxBytes?: number): Promise<Record<string, unknown>>;
export function makeGuestWorkload(): DiagnosticWorkloadItem[];
export function orderNativeModules(paths: string[], main: string): string[];
export function readGuestCookie(header: string | null): string;
export function tableDigest(rows: Record<string, unknown>[]): { count: number; sha256: string };
export function preserveAdmissions(before: Record<string, unknown>[], after: Record<string, unknown>[]): boolean;
export function createNativeRequestAdapter(options: {
  origin: string;
  secrets: Record<string, string>;
  sensitiveValues: string[];
  syntheticClientAddress?: boolean;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): {
  request(url: string, init: { method: string; redirect: 'manual'; signal: AbortSignal; item: DiagnosticWorkloadItem; receipt?: string }): Promise<Response>;
  quiesce(timeoutMs?: number): Promise<boolean>;
};
