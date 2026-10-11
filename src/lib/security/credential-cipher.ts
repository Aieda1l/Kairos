import {
  type CredentialKeyring,
  type SecretPurpose,
} from "./credential-types";

export type {CredentialKeyring,SecretPurpose} from "./credential-types";

const VERSION="v1";
const IV_BYTES=12;
const KEY_BYTES=32;
const KEY_ID=/^[A-Za-z0-9_-]+$/;

type EncryptInput={
  plaintext:string;
  userId:string;
  purpose:SecretPurpose;
  contextId:string;
};

type DecryptInput=Omit<EncryptInput,"plaintext">&{
  envelope:string;
};

export class CredentialCipherError extends Error{
  readonly code="CREDENTIAL_DECRYPT_FAILED";

  constructor(){
    super("Credential could not be decrypted.");
    this.name="CredentialCipherError";
  }
}

export class CredentialKeyConfigurationError extends Error{
  readonly code="CREDENTIAL_KEY_INVALID";

  constructor(message:string){
    super(message);
    this.name="CredentialKeyConfigurationError";
  }
}

function aad(input:{userId:string;purpose:SecretPurpose;contextId:string}):Uint8Array{
  return new TextEncoder().encode(
    `kairos:${VERSION}:${input.userId}:${input.purpose}:${input.contextId}`,
  );
}

function encodeBase64Url(bytes:Uint8Array):string{
  let binary="";
  for(const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g,"-")
    .replace(/\//g,"_")
    .replace(/=+$/,"");
}

function decodeBase64Url(value:string):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(value)){
    throw new CredentialCipherError();
  }

  const padded=value.replace(/-/g,"+").replace(/_/g,"/")
    +"=".repeat((4-(value.length%4))%4);

  let binary:string;
  try{
    binary=atob(padded);
  }catch{
    throw new CredentialCipherError();
  }

  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  if(encodeBase64Url(bytes)!==value){
    throw new CredentialCipherError();
  }
  return bytes;
}

function rawKey(keyring:CredentialKeyring,keyId:string,forDecrypt:boolean):Uint8Array{
  const key=keyring.keys[keyId];
  if(!key || key.byteLength!==KEY_BYTES){
    if(forDecrypt) throw new CredentialCipherError();
    throw new CredentialKeyConfigurationError(
      `Credential key "${keyId}" must contain exactly ${KEY_BYTES} bytes.`,
    );
  }
  return key;
}

function toArrayBuffer(bytes:Uint8Array):ArrayBuffer{
  const copy=new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importAesKey(bytes:Uint8Array,usage:KeyUsage):Promise<CryptoKey>{
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(bytes),
    {name:"AES-GCM"},
    false,
    [usage],
  );
}

export async function encryptCredential(
  input:EncryptInput,
  keyring:CredentialKeyring,
):Promise<string>{
  const keyId=keyring.activeKeyId;
  if(!KEY_ID.test(keyId)){
    throw new CredentialKeyConfigurationError("Credential key id is invalid.");
  }

  const key=await importAesKey(rawKey(keyring,keyId,false),"encrypt");
  const iv=crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext=new TextEncoder().encode(input.plaintext);
  const encrypted=await crypto.subtle.encrypt(
    {
      name:"AES-GCM",
      iv:toArrayBuffer(iv),
      additionalData:toArrayBuffer(aad(input)),
    },
    key,
    toArrayBuffer(plaintext),
  );

  return [
    VERSION,
    keyId,
    encodeBase64Url(iv),
    encodeBase64Url(new Uint8Array(encrypted)),
  ].join(".");
}

export async function decryptCredential(
  input:DecryptInput,
  keyring:CredentialKeyring,
):Promise<string>{
  try{
    const parts=input.envelope.split(".");
    if(parts.length!==4) throw new CredentialCipherError();

    const [version,keyId,encodedIv,encodedCiphertext]=parts;
    if(version!==VERSION || !KEY_ID.test(keyId)){
      throw new CredentialCipherError();
    }

    const iv=decodeBase64Url(encodedIv);
    const ciphertext=decodeBase64Url(encodedCiphertext);
    if(iv.byteLength!==IV_BYTES) throw new CredentialCipherError();

    const key=await importAesKey(rawKey(keyring,keyId,true),"decrypt");
    const decrypted=await crypto.subtle.decrypt(
      {
        name:"AES-GCM",
        iv:toArrayBuffer(iv),
        additionalData:toArrayBuffer(aad(input)),
      },
      key,
      toArrayBuffer(ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  }catch(error){
    if(error instanceof CredentialCipherError) throw error;
    throw new CredentialCipherError();
  }
}
