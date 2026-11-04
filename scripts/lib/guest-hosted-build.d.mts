export type FileIdentity = {
  path: string;
  sha256: string;
  bytes: number;
  gitBlob?: string;
};
export type ModuleGraph = {
  modules: FileIdentity[];
  data: FileIdentity[];
  edges: {
    from: string;
    to: string;
    kind: string;
  }[];
  computedExceptions: Record<string, unknown>[];
  externalCapabilities: string[];
  dynamicCodeCapabilities?: Record<string, unknown>[];
  limitations: string[];
};
export type BuildReceipt = {
  version: 1;
  status: 'built';
  applicationRevision: string;
  sourceRoot: string;
  outputRoot: string;
  receiptPath: string;
  exit: 0;
  sourceInputs: FileIdentity[];
  graph: ModuleGraph;
  [key: string]: unknown;
};
export const workspaceRoot: string;
export function sha256(bytes: string | Uint8Array): string;
export function canonical(value: unknown): string;
export function ownedOutput(path: string, options?: {
  fresh?: boolean;
}): Promise<string>;
export function safeFiles(root: string): Promise<string[]>;
export function sanitizedBuildEnvironment(stateDirectory: string): Record<string, string>;
export function inspectGuestHostedModules(root: string): Promise<ModuleGraph>;
export function buildGuestHostedApplication(options: {
  applicationRevision: string;
  outputRoot: string;
}): Promise<BuildReceipt>;
