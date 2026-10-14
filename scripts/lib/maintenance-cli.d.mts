export function parseMaintenanceArgs(mode:'rotate',args:string[]):{apply:boolean;batchSize:number};
export function parseMaintenanceArgs(mode:'cleanup',args:string[]):{apply:boolean;batchSize:number};
export function parseMaintenanceArgs(mode:'set-control',args:string[]):{apply:boolean;key:string;enabled:boolean};
export function parseMaintenanceArgs(mode:'recover',args:string[]):{apply:boolean;settlementConfirmed:boolean;operationKey:string};
export function runMaintenanceCli(mode:'cleanup'|'set-control'|'recover',args?:string[],env?:Record<string,string|undefined>):Promise<number>;
