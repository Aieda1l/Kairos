import 'server-only';
import {deriveAbuseSubkey} from '@/lib/abuse/keys';
import {AbuseConfigurationError} from '@/lib/abuse/types';
import {isLoopbackOrigin} from '@/lib/security/request-origin';
import {GUEST_CAPABILITY_MS} from '../limits';
import {GuestRequestError,type GuestCapability,type GuestServerRuntime} from './types';

function invalid():never{throw new GuestRequestError('GUEST_SESSION_REQUIRED');}
function encode(bytes:Uint8Array):string {
  return btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(value:string):Uint8Array<ArrayBuffer> {
  if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)invalid();
  const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),char=>char.charCodeAt(0));
  if(encode(bytes)!==value)invalid();
  return bytes;
}
async function signingKey(runtime:GuestServerRuntime):Promise<CryptoKey> {
  const key=await deriveAbuseSubkey(runtime.hmacKey,'guest-capability');
  return crypto.subtle.importKey('raw',new Uint8Array(key).buffer,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function mintGuestCapability(runtime:GuestServerRuntime,nowMs:number):Promise<{value:string;expiresAt:string}> {
  if(!Number.isSafeInteger(nowMs)||nowMs<0||!Number.isSafeInteger(nowMs+GUEST_CAPABILITY_MS))throw new AbuseConfigurationError();
  const claims:GuestCapability={v:1,sid:encode(crypto.getRandomValues(new Uint8Array(32))),aud:runtime.appOrigin,iatMs:nowMs,expMs:nowMs+GUEST_CAPABILITY_MS};
  const payload=encode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(runtime),new TextEncoder().encode(payload))));
  return {value:`${payload}.${signature}`,expiresAt:new Date(claims.expMs).toISOString()};
}
export async function verifyGuestCapability(value:string,runtime:GuestServerRuntime,nowMs:number):Promise<GuestCapability> {
  try {
    if(typeof value!=='string'||value.length>1024||!Number.isSafeInteger(nowMs)||nowMs<0)invalid();
    const parts=value.split('.');if(parts.length!==2)invalid();
    const [payload,signature]=parts;
    const payloadBytes=decode(payload),signatureBytes=decode(signature);
    if(signatureBytes.length!==32||!await crypto.subtle.verify('HMAC',await signingKey(runtime),signatureBytes,new TextEncoder().encode(payload)))invalid();
    const claims:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payloadBytes));
    if(!claims||typeof claims!=='object'||Array.isArray(claims)||Object.keys(claims).sort().join(',')!=='aud,expMs,iatMs,sid,v')invalid();
    const {v,sid,aud,iatMs,expMs}=claims as GuestCapability;
    if(v!==1||aud!==runtime.appOrigin||typeof sid!=='string'||decode(sid).length!==32
      ||!Number.isSafeInteger(iatMs)||iatMs<0||!Number.isSafeInteger(expMs)||expMs-iatMs!==GUEST_CAPABILITY_MS
      ||iatMs>nowMs+30_000||expMs<=nowMs)invalid();
    return {v,sid,aud,iatMs,expMs};
  }catch{invalid();}
}
/** The canonical server configuration alone selects the cookie namespace. */
export function guestCookieName(runtime:GuestServerRuntime):string {
  const origin=new URL(runtime.appOrigin);
  if(origin.protocol==='https:')return '__Host-kairos-guest-sync';
  if(origin.protocol==='http:'&&runtime.trustedIngress==='loopback'&&isLoopbackOrigin(origin))return 'kairos-guest-sync-dev';
  throw new AbuseConfigurationError();
}
export function guestCapabilityCookie(runtime:GuestServerRuntime,value:string,clear=false):string {
  const name=guestCookieName(runtime);
  return `${name}=${clear?'':value}; Path=/; HttpOnly; ${name.startsWith('__Host-')?'Secure; ':''}SameSite=Strict; Max-Age=${clear?0:GUEST_CAPABILITY_MS/1000}`;
}
export async function readGuestCapability(headers:Headers,runtime:GuestServerRuntime,nowMs:number):Promise<GuestCapability> {
  const name=guestCookieName(runtime);
  const cookies=(headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));
  if(cookies.length!==1)invalid();
  return verifyGuestCapability(cookies[0].slice(name.length+1),runtime,nowMs);
}
