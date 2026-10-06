import { describe, expect, it } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  type CredentialKeyring,
} from "@/lib/security/credential-cipher";

function key(fill:number):Uint8Array{
  return new Uint8Array(32).fill(fill);
}

const keyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:key(7)},
};

const input={
  plaintext:"super-secret-value",
  userId:"alice",
  purpose:"canvas_feed_url" as const,
  contextId:"source-alice",
};

describe("credential cipher",()=>{
  it("round-trips a credential in a versioned randomized envelope",async()=>{
    const first=await encryptCredential(input,keyring);
    const second=await encryptCredential(input,keyring);

    expect(first).toMatch(/^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain(input.plaintext);
    await expect(decryptCredential({...input,envelope:first},keyring)).resolves.toBe(input.plaintext);
  });

  it.each([
    ["userId","bob"],
    ["purpose","ed_api_token"],
    ["contextId","source-bob"],
  ] as const)("rejects ciphertext moved to the wrong %s",async(field,value)=>{
    const envelope=await encryptCredential(input,keyring);
    await expect(decryptCredential({
      ...input,
      envelope,
      [field]:value,
    },keyring)).rejects.toMatchObject({code:"CREDENTIAL_DECRYPT_FAILED"});
  });

  it("rejects the wrong key even when the key id matches",async()=>{
    const envelope=await encryptCredential(input,keyring);
    await expect(decryptCredential({...input,envelope},{
      activeKeyId:"k1",
      keys:{k1:key(8)},
    })).rejects.toMatchObject({code:"CREDENTIAL_DECRYPT_FAILED"});
  });

  it.each([2,3])("rejects tampering with envelope segment %i",async(segment)=>{
    const envelope=await encryptCredential(input,keyring);
    const parts=envelope.split(".");
    const value=parts[segment];
    parts[segment]=`${value.slice(0,-1)}${value.endsWith("A")?"B":"A"}`;

    await expect(decryptCredential({...input,envelope:parts.join(".")},keyring))
      .rejects.toMatchObject({code:"CREDENTIAL_DECRYPT_FAILED"});
  });

  it("rejects unknown versions and key ids without exposing details",async()=>{
    const envelope=await encryptCredential(input,keyring);
    const parts=envelope.split(".");

    await expect(decryptCredential({...input,envelope:["v2",...parts.slice(1)].join(".")},keyring))
      .rejects.toMatchObject({code:"CREDENTIAL_DECRYPT_FAILED"});
    await expect(decryptCredential({...input,envelope:[parts[0],"missing",...parts.slice(2)].join(".")},keyring))
      .rejects.toMatchObject({code:"CREDENTIAL_DECRYPT_FAILED"});
  });
});
