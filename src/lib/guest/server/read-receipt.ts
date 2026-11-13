import 'server-only';
import {deriveAbuseSubkey} from '@/lib/abuse/keys';
import {AbuseConfigurationError} from '@/lib/abuse/types';
import {decodeGuestWireBytes,encodeGuestWireBytes,readGuestReadReceiptMetadata,type GuestReadReceiptClaims} from '../sources/wire';
import {GuestRequestError,type GuestCapability,type GuestServerRuntime} from './types';
const enc=new TextEncoder();
async function key(runtime:GuestServerRuntime){const bytes=await deriveAbuseSubkey(runtime.hmacKey,'guest-read-approval');return crypto.subtle.importKey('raw',new Uint8Array(bytes).buffer,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function tag(k:CryptoKey,sid:string){return encodeGuestWireBytes(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(JSON.stringify(['kairos:guest-read-session:v2',sid])))));}
export async function mintGuestReadReceipt(runtime:GuestServerRuntime,cap:GuestCapability,claims:Omit<GuestReadReceiptClaims,'v'|'aud'|'sessionTag'>):Promise<string>{
 try{const k=await key(runtime);const payload=encodeGuestWireBytes(enc.encode(JSON.stringify({...claims,v:2,aud:runtime.appOrigin,sessionTag:await tag(k,cap.sid)})));const sig=encodeGuestWireBytes(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(JSON.stringify(['kairos:guest-read-receipt:v2',payload])))));const token=payload+'.'+sig;if(!readGuestReadReceiptMetadata(token)||claims.deadlineAtMs>cap.expMs)throw new Error();return token;}catch{throw new AbuseConfigurationError();}
}
export async function verifyGuestReadReceipt(token:string,runtime:GuestServerRuntime,cap:GuestCapability,requestId:string):Promise<GuestReadReceiptClaims>{
 const claims=readGuestReadReceiptMetadata(token);if(!claims)throw new GuestRequestError('BAD_REQUEST');
 try{const k=await key(runtime);const [payload,sig]=token.split('.');if(!await crypto.subtle.verify('HMAC',k,decodeGuestWireBytes(sig),enc.encode(JSON.stringify(['kairos:guest-read-receipt:v2',payload])))||claims.aud!==runtime.appOrigin||claims.requestId!==requestId||claims.sessionTag!==await tag(k,cap.sid)||claims.deadlineAtMs>cap.expMs||claims.issuedAtMs>runtime.now())throw new GuestRequestError('BAD_REQUEST');return claims;}catch(error){if(error instanceof GuestRequestError)throw error;throw new GuestRequestError('SERVICE_UNAVAILABLE');}
}
