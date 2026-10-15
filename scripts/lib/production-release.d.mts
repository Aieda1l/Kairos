export function assertReleaseGate(input:{ref:string;sha:string;repository:string;runs:unknown[]}):void;
export function parseUploadedVersion(rows:unknown[],alias:string,workersSubdomain:string):{versionId:string;url:string};
export function verifyStagedHealth(url:string,fetchImpl?:typeof fetch):Promise<void>;
export function verifyStagedIsolation(url:string,fetchImpl?:typeof fetch):Promise<void>;
