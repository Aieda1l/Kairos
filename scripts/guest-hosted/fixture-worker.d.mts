export type FixtureOperation = {
  key: string;
  method: string;
  url: string;
  cap: number;
  body: string;
  contentType: string;
  credentialBinding?: string;
};
export type FixtureScenario = {
  version: number;
  runId: string;
  scenario: string;
  hostname: string;
  operations: FixtureOperation[];
};
export function matchFixtureOperation(request: Request, env: Record<string, unknown>, scenario: FixtureScenario): Promise<FixtureOperation | null>;
export function handleFixtureRequest(request: Request, env: Record<string, unknown>, scenario: FixtureScenario, bodies: Record<string, Uint8Array>): Promise<Response>;
