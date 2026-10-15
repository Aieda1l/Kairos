export type HealthResult={ok:boolean;code:string;status:number};
export function checkProductionHealth(options?:{origin?:string;fetchImpl?:typeof fetch;timeoutMs?:number}):Promise<HealthResult>;
