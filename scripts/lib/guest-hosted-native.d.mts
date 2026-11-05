import type { DiagnosticWorkloadItem } from './guest-hosted-diagnostic.mjs';
export const NATIVE_PACKAGE_DIGEST: string;
export const NATIVE_INVENTORY: { readonly [key: string]: string | number | null };
export function makeGuestWorkload(): DiagnosticWorkloadItem[];
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
  request(url: string, init: { method: string; redirect: 'manual'; signal: AbortSignal; item: DiagnosticWorkloadItem }): Promise<Response>;
  quiesce(timeoutMs?: number): Promise<boolean>;
};
