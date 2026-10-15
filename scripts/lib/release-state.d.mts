export const approvedMigrations:readonly string[];
export function assertVersionConfiguration(version:unknown,input:{versionId:string;sha:string;databaseId:string}):void;
export function verifyReleaseState(input:{phase:string;env:Record<string,string|undefined>;fetchImpl?:typeof fetch}):Promise<{workersSubdomain?:string}>;
