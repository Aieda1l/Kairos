import type {D1DatabaseLike} from '../../src/lib/db/d1/types';
export function setAbuseControl(db:D1DatabaseLike,options:{key:string;enabled:boolean;apply:boolean}):Promise<{changed:number;enabled:boolean;version:number}>;
export function maintainAbuseState(db:D1DatabaseLike,options:{batchSize:number;apply:boolean}):Promise<{rateEvents:number;runs:number;oauthRequests:number;bridgeRequests:number}>;
export function recoverOperation(db:D1DatabaseLike,options:{userId:string;operationKey:string;ownerNonce:string;apply:boolean;settlementConfirmed:boolean}):Promise<{eligible:number;recovered:number}>;
