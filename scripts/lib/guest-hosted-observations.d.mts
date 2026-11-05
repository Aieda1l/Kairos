import type { DiagnosticSnapshot, DiagnosticWorkloadItem } from './guest-hosted-diagnostic.mjs';
export function prepareHostedDiagnostic(options: {
  input: unknown;
  expectedDigest: string;
  credentials: unknown;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  verifyPackage?: (options: { manifestPath: string; inventory: Record<string, unknown>; mode?: string }) => Promise<{ manifestPath: string; packageDigest: string; mode: string; manifest: { inventory: Record<string, unknown> } }>;
}): Promise<{
  executionMode: 'hosted';
  verifiedPackage: { manifestPath: string; packageDigest: string; mode: string; manifest: { inventory: { hostname: string; runId: string; scenario: string; [key: string]: unknown } } };
  targetOrigin: string;
  sensitiveValues: string[];
  request(url: string, init: { method: string; redirect: 'manual'; signal: AbortSignal; item: DiagnosticWorkloadItem }): Promise<Response>;
  observations: { before(): Promise<DiagnosticSnapshot>; quiesce(): Promise<boolean>; after(): Promise<DiagnosticSnapshot> };
  observerCosts: { metadataRequests: number; queryRequests: number; rowsRead: number; rowsWritten: number; appD1: { rowsRead: number; rowsWritten: number }; fixtureD1: { rowsRead: number; rowsWritten: number }; exactPerApplicationRequest: null; platformBilling: null };
  limits: Record<string, number>;
  authorization: Record<string, unknown>;
  dispose(): Promise<void>;
}>;
