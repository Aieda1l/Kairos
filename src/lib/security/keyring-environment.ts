import 'server-only';
import {CredentialKeyConfigurationError,type CredentialKeyring} from './credential-cipher';
const invalid=()=>new CredentialKeyConfigurationError('Credential key configuration is invalid.');
function decode(raw:unknown):Uint8Array{
  if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw invalid();
  let bytes:Uint8Array;
  try{bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')+'='),char=>char.charCodeAt(0));}catch{throw invalid();}
  const canonical=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(bytes.length!==32||canonical!==raw)throw invalid();
  return bytes;
}
export function credentialKeyringFromBindings(env:Record<string,unknown>):CredentialKeyring{
  const activeKeyId=env.KAIROS_CREDENTIAL_ACTIVE_KEY_ID??'v1';
  if(activeKeyId!=='v1'&&activeKeyId!=='v2')throw invalid();
  const keys:Record<string,Uint8Array>={v1:decode(env.KAIROS_CREDENTIAL_KEY_V1)};
  const second=env.KAIROS_CREDENTIAL_KEY_V2;
  if(second!==undefined&&second!=='')keys.v2=decode(second);
  if(activeKeyId==='v2'&&!keys.v2)throw invalid();
  if(keys.v2&&keys.v2.every((byte,index)=>byte===keys.v1[index]))throw invalid();
  return {activeKeyId,keys:Object.freeze(keys)};
}
