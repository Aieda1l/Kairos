import "server-only";
import {AbuseClientAddressError,AbuseConfigurationError,AbuseSubjectError,type RateSubject,type TrustedIngress} from "./types";

// Stable v1 domain labels must survive deploys for the entire live event window.
const NAMESPACE="kairos:abuse:v1";
function encode(bytes:Uint8Array):string{
  return btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(""))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function decodeKey(value:string):Uint8Array{
  return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"="),char=>char.charCodeAt(0));
}
export function abuseKeyFromEnvironment(value:unknown,credentialKey?:unknown):Uint8Array{
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new AbuseConfigurationError();
  const bytes=decodeKey(value);
  if(bytes.length!==32||encode(bytes)!==value)throw new AbuseConfigurationError();
  // The existing credential runtime accepts alternate pad bits. Compare bytes
  // rather than encoded strings without requiring credential setup here.
  if(typeof credentialKey==="string"&&/^[A-Za-z0-9_-]{43}$/.test(credentialKey)){
    const credentialBytes=decodeKey(credentialKey);
    if(bytes.every((byte,index)=>byte===credentialBytes[index]))throw new AbuseConfigurationError();
  }
  return bytes;
}
async function hmac(key:Uint8Array,message:string):Promise<Uint8Array>{
  if(key.byteLength!==32)throw new AbuseConfigurationError();
  const cryptoKey=await crypto.subtle.importKey("raw",new Uint8Array(key).buffer,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(message)));
}
export function deriveAbuseSubkey(key:Uint8Array,purpose:"rate-key"|"auth-attempt"):Promise<Uint8Array>{
  if(purpose!=="rate-key"&&purpose!=="auth-attempt")throw new AbuseConfigurationError();
  return hmac(key,JSON.stringify([NAMESPACE,"subkey",purpose]));
}
export async function hashRateKey(key:Uint8Array,parts:readonly string[]):Promise<string>{
  return encode(await hmac(await deriveAbuseSubkey(key,"rate-key"),JSON.stringify([NAMESPACE,"rate-key",...parts])));
}

function ipv4(value:string):number[]|null{
  const parts=value.split(".");
  if(parts.length!==4||parts.some(part=>!/^(0|[1-9][0-9]{0,2})$/.test(part)||Number(part)>255))return null;
  return parts.map(Number);
}
export function normalizeClientNetwork(address:string):string{
  if(typeof address!=="string"||address.length>45||!/^[0-9a-fA-F:.]+$/.test(address))throw new AbuseClientAddressError();
  const v4=ipv4(address);
  if(v4)return `ipv4:${v4.join(".")}`;
  let value=address;
  if(value.includes(".")){
    const lastColon=value.lastIndexOf(":"),tail=ipv4(value.slice(lastColon+1));
    if(!tail)throw new AbuseClientAddressError();
    value=value.slice(0,lastColon+1)+((tail[0]<<8)|tail[1]).toString(16)+":"+((tail[2]<<8)|tail[3]).toString(16);
  }
  const halves=value.split("::");
  if(halves.length>2)throw new AbuseClientAddressError();
  const left=halves[0]?halves[0].split(":"):[];
  const right=halves.length===2&&halves[1]?halves[1].split(":"):[];
  const explicit=[...left,...right];
  if(explicit.some(part=>!/^[0-9a-fA-F]{1,4}$/.test(part))
    ||(halves.length===1?explicit.length!==8:explicit.length>=8))throw new AbuseClientAddressError();
  const words=[...left.map(part=>parseInt(part,16)),...Array(8-explicit.length).fill(0),...right.map(part=>parseInt(part,16))] as number[];
  if(words.slice(0,5).every(word=>word===0)&&words[5]===0xffff){
    return `ipv4:${words[6]>>8}.${words[6]&255}.${words[7]>>8}.${words[7]&255}`;
  }
  return `ipv6:${words.slice(0,4).map(word=>word.toString(16)).join(":")}::/64`;
}

// Trust is established by server deployment configuration, never a request header.
// Cloudflare mode requires edge-only ingress and no untrusted same-zone Worker rewrite.
export function trustedClientNetwork(headers:Headers,ingress:TrustedIngress):string{
  if(ingress!=="cloudflare")throw new AbuseClientAddressError();
  const address=headers.get("cf-connecting-ip");
  if(!address)throw new AbuseClientAddressError();
  const network=normalizeClientNetwork(address);
  if(network.startsWith("ipv4:")&&Number(network.slice(5).split(".")[0])>=240){
    const realIPv6=headers.get("cf-connecting-ipv6");
    if(realIPv6){
      const normalized=normalizeClientNetwork(realIPv6);
      if(!normalized.startsWith("ipv6:"))throw new AbuseClientAddressError();
      return normalized;
    }
  }
  return network;
}

function identifier(value:string):void{
  if(typeof value!=="string"||!value.trim()||value.length>256)throw new AbuseSubjectError();
}
export function rateKeyParts(subject:RateSubject):string[]{
  if(subject.class==="auth-initiation"){
    if(!["google","microsoft-entra-id"].includes(subject.provider))throw new AbuseSubjectError();
    const network=subject.network;
    if(typeof network!=="string")throw new AbuseSubjectError();
    const address=network.startsWith("ipv4:")?network.slice(5):network.startsWith("ipv6:")&&network.endsWith("/64")?network.slice(5,-3):"";
    if(normalizeClientNetwork(address)!==network)throw new AbuseClientAddressError();
    return [subject.class,subject.provider,network];
  }
  identifier(subject.userId);
  switch(subject.class){
    case "credential":
      if(!["canvas","gradescope","ed","google","microsoft","caldav"].includes(subject.provider))throw new AbuseSubjectError();
      return [subject.class,subject.userId,subject.provider];
    case "source-sync":
    case "calendar-sync":
      if(!(subject.class==="source-sync"?["canvas","gradescope","ed"]:["google","microsoft","caldav"]).includes(subject.provider))throw new AbuseSubjectError();
      identifier(subject.resourceId);
      return [subject.class,subject.userId,subject.provider,subject.resourceId];
    case "sync-all":case "deletion":return [subject.class,subject.userId];
    default:throw new AbuseSubjectError();
  }
}
