export interface DiagnosticWorkloadItem {
  method: string;
  path: string;
  phase?: number;
  case?: 'wrong-origin' | 'missing-capability';
  near?: boolean;
  requestId?: string;
  courseId?: string;
  expectedCount?: number;
}
export interface DiagnosticSnapshot {
  tables: Record<string, { count: number; sha256: string }>;
  identifiedAdmissions: number;
  priorAdmissionsPreserved?: boolean;
  fixtureTables: Record<string, { count: number; sha256: string }>;
  fixture: Record<string, { runId: string; scenario: string; cap: number; calls: number }>;
}
export interface DiagnosticReceipt {
  schemaVersion: number;
  status: string;
  code: string;
  packageDigest: string;
  attempted: number;
  completed: number;
  logicalCompleted: number;
  physical: { stage: string; status: number | null; validMediaType: boolean; noStore: boolean; private: boolean; wireVersion2: boolean }[];
  metrics: Record<string, { value: null; reason: string }>;
  costs: Record<string, null>;
  observation?: Record<string, unknown>;
}
type Schema = { safeParse(value: unknown): { success: boolean } };
export function loadGuestHostedSchemas(options: { verifiedPackage: { manifestPath: string; packageDigest: string; mode: string; manifest: Record<string, unknown> } }): Promise<{ schemas: Record<string, Schema>; provenance: { externalImports: number; [key: string]: unknown } }>;
export function runGuestHostedDiagnostic(options: {
  verifiedPackage: { packageDigest: string; mode: string; manifest: { inventory: { hostname: string; runId: string; scenario: string; [key: string]: unknown } } };
  targetOrigin: string;
  workload: DiagnosticWorkloadItem[];
  request: (url: string, options: { method: string; redirect: 'manual'; signal: AbortSignal; item: DiagnosticWorkloadItem; receipt?: string }) => Response | Promise<Response>;
  observations: { before(): DiagnosticSnapshot | Promise<DiagnosticSnapshot>; quiesce(): boolean | Promise<boolean>; after(): DiagnosticSnapshot | Promise<DiagnosticSnapshot> };
  schemas?: Record<string, Schema>;
  /** Supply non-cookie synthetic secrets for response-echo checks. Bootstrap cookies are remembered automatically. */
  sensitiveValues?: string[];
}): Promise<DiagnosticReceipt>;
