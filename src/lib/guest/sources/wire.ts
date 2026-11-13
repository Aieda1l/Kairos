import {z} from 'zod';
import {GUEST_MAX_SECRET_CHARACTERS,GUEST_MAX_DECIMAL_ID_CHARACTERS} from '../limits';
export type GuestSourceOperation='canvas-feed'|'ed-courses'|'ed-lessons';
export type GuestParseContext={requestId:string;checkedAt:string}&({operation:'canvas-feed'|'ed-courses';courseId?:never}|{operation:'ed-lessons';courseId:string});
export type GuestSourceParseInput=GuestParseContext&{bytes:ArrayBuffer};
export const GUEST_SOURCE_WIRE_VERSION=2 as const;
export const GUEST_SOURCE_VERSION_HEADER='x-kairos-guest-source-version';
export const GUEST_READ_RECEIPT_HEADER='x-kairos-guest-read-receipt';
const uuid=z.string().uuid(), course=z.string().min(1).max(GUEST_MAX_DECIMAL_ID_CHARACTERS).regex(/^\d+$/), secret=z.string().min(1).max(GUEST_MAX_SECRET_CHARACTERS);
const fields={schemaVersion:z.literal(2),requestId:uuid};
export const guestCanvasFeedWireSchema=z.object({...fields,feedUrl:secret}).strict();
export const guestEdCoursesWireSchema=z.object({...fields,token:secret}).strict();
export const guestEdLessonsWireSchema=z.object({...fields,token:secret,courseId:course}).strict();
export type GuestCanvasFeedWireInput=z.infer<typeof guestCanvasFeedWireSchema>;
export type GuestEdCoursesWireInput=z.infer<typeof guestEdCoursesWireSchema>;
export type GuestEdLessonsWireInput=z.infer<typeof guestEdLessonsWireSchema>;
export const guestSourceApprovalRequestSchema=z.object({...fields,receipt:z.string().min(1).max(2048)}).strict();
export const guestSourceApprovalAckSchema=z.object({ok:z.literal(true),...fields,checkedAt:z.iso.datetime(),operation:z.enum(['canvas-feed','ed-courses','ed-lessons']),courseId:course.nullable()}).strict().refine(v=>(v.operation==='ed-lessons')===(v.courseId!==null));
export type GuestSourceApprovalRequest=z.infer<typeof guestSourceApprovalRequestSchema>;
export type GuestSourceApprovalAck=z.infer<typeof guestSourceApprovalAckSchema>;
const safeInt=z.number().int().nonnegative().safe();
export const guestReadReceiptClaimsSchema=z.object({v:z.literal(2),aud:z.string().min(1),sessionTag:z.string(),operation:z.enum(['canvas-feed','ed-courses','ed-lessons']),requestId:uuid,checkedAt:z.iso.datetime(),issuedAtMs:safeInt,deadlineAtMs:safeInt,providerVersion:safeInt,courseId:course.nullable()}).strict().refine(v=>v.deadlineAtMs>v.issuedAtMs&&v.deadlineAtMs-v.issuedAtMs<=15000&&new Date(v.issuedAtMs).toISOString()===v.checkedAt&&(v.operation==='ed-lessons')===(v.courseId!==null));
export type GuestReadReceiptClaims=z.infer<typeof guestReadReceiptClaimsSchema>;
export function encodeGuestWireBytes(bytes:Uint8Array):string{return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeGuestWireBytes(value:string):Uint8Array<ArrayBuffer>{if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw new Error('Invalid encoding');const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));if(encodeGuestWireBytes(bytes)!==value)throw new Error('Invalid encoding');return bytes;}
export function readGuestReadReceiptMetadata(token:string):GuestReadReceiptClaims|null{try{if(typeof token!=='string'||token.length>2048) return null;const parts=token.split('.');if(parts.length!==2||decodeGuestWireBytes(parts[1]).length!==32)return null;const claims=guestReadReceiptClaimsSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeGuestWireBytes(parts[0]))));if(decodeGuestWireBytes(claims.sessionTag).length!==32)return null;return claims;}catch{return null;}}
