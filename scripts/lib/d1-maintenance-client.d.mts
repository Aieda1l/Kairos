import type {D1DatabaseLike} from '../../src/lib/db/d1/types';
export function createD1MaintenanceClient(env:Record<string,unknown>,options?:{fetch?:typeof fetch;timeoutMs?:number;maxResponseBytes?:number}):D1DatabaseLike;
