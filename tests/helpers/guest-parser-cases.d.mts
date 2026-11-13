import type {GuestSourceOperation} from '../../src/lib/guest/sources/wire';
export type GuestParserCase={name:string;operation:GuestSourceOperation;courseId?:string;body:string;bytes?:number[];digestOnly?:boolean};
export const requestId:string;
export const checkedAt:string;
export const cases:GuestParserCase[];
export function bytesForCase(item:GuestParserCase):Uint8Array<ArrayBuffer>;
