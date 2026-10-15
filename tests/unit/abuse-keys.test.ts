import {describe,expect,it} from "vitest";

const key=Uint8Array.from({length:32},(_,index)=>index+1);

describe("private abuse keys",()=>{
  it.each([
    ["203.0.113.8","ipv4:203.0.113.8"],
    ["2001:0DB8:0001:0002:1234:5678:9abc:def0","ipv6:2001:db8:1:2::/64"],
    ["2001:db8:1:2::1","ipv6:2001:db8:1:2::/64"],
    ["::1","ipv6:0:0:0:0::/64"],
    ["::ffff:203.0.113.8","ipv4:203.0.113.8"],
    ["0:0:0:0:0:ffff:cb00:7108","ipv4:203.0.113.8"],
  ])("normalizes %s",async(address,expected)=>{
    const {normalizeClientNetwork}=await import("@/lib/abuse/keys");
    expect(normalizeClientNetwork(address)).toBe(expected);
  });

  it.each(["", " 203.0.113.8", "203.0.113.08", "256.0.0.1", "127.1", "0x7f000001",
    "203.0.113.8:443", "203.0.113.8, 198.51.100.1", "[2001:db8::1]", "fe80::1%eth0",
    "1::2::3", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::8", "private.example"])
  ("rejects malformed address without echoing %s",async address=>{
    const {normalizeClientNetwork}=await import("@/lib/abuse/keys");
    expect(()=>normalizeClientNetwork(address)).toThrowError(expect.objectContaining({code:"ABUSE_CLIENT_ADDRESS_INVALID"}));
  });

  it("requires server-selected ingress and ignores arbitrary forwarded addresses",async()=>{
    const {trustedClientNetwork}=await import("@/lib/abuse/keys");
    const headers=new Headers({"cf-connecting-ip":"203.0.113.8","x-forwarded-for":"198.51.100.9","x-real-ip":"198.51.100.10"});
    expect(trustedClientNetwork(headers,"cloudflare")).toBe("ipv4:203.0.113.8");
    expect(()=>trustedClientNetwork(headers,"none")).toThrowError(expect.objectContaining({code:"ABUSE_CLIENT_ADDRESS_INVALID"}));
    headers.delete("cf-connecting-ip");
    expect(()=>trustedClientNetwork(headers,"cloudflare")).toThrow();
    headers.set("cf-connecting-ip","203.0.113.8, 198.51.100.9");
    expect(()=>trustedClientNetwork(headers,"cloudflare")).toThrow();
  });

  it("uses real IPv6 when the trusted edge supplies Pseudo IPv4 overwrite headers",async()=>{
    const {trustedClientNetwork}=await import("@/lib/abuse/keys");
    expect(trustedClientNetwork(new Headers({"cf-connecting-ip":"240.0.0.1","cf-connecting-ipv6":"2001:db8:1:2::1"}),"cloudflare"))
      .toBe("ipv6:2001:db8:1:2::/64");
  });

  it("derives stable domain-separated subkeys and opaque framed HMACs",async()=>{
    const {deriveAbuseSubkey,hashRateKey}=await import("@/lib/abuse/keys");
    const rate=await deriveAbuseSubkey(key,"rate-key");
    const attempt=await deriveAbuseSubkey(key,"auth-attempt");
    expect(rate).not.toEqual(key);
    expect(rate).not.toEqual(attempt);
    expect(await deriveAbuseSubkey(key,"rate-key")).toEqual(rate);
    const hash=await hashRateKey(key,["auth-initiation","google","ipv4:203.0.113.8"]);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Independent Node HMAC fixture pins the live v1 namespace across deploys.
    expect(hash).toBe("P-MiIrZSH6OKCozi3nyDykVfiJIvCOqrOy6ruVWXeb0");
    expect(await hashRateKey(new Uint8Array(key),["auth-initiation","google","ipv4:203.0.113.8"])).toBe(hash);
    expect(await hashRateKey(key,["auth-initiation","microsoft-entra-id","ipv4:203.0.113.8"])).not.toBe(hash);
    expect(await hashRateKey(key,["a:b","c"])).not.toBe(await hashRateKey(key,["a","b:c"]));
    expect(await hashRateKey(new Uint8Array(32).fill(9),["auth-initiation","google","ipv4:203.0.113.8"])).not.toBe(hash);
    expect(hash).not.toContain("203.0.113");
    await expect(deriveAbuseSubkey(new Uint8Array(31),"rate-key")).rejects.toMatchObject({code:"ABUSE_CONFIG_INVALID"});
  });

  it("hashes canonical aliases into the same network and separates the next /64",async()=>{
    const {normalizeClientNetwork,hashRateKey}=await import("@/lib/abuse/keys");
    const hash=(ip:string)=>hashRateKey(key,["auth-initiation","google",normalizeClientNetwork(ip)]);
    expect(await hash("2001:0DB8:0001:0002:1234:5678:9abc:def0")).toBe(await hash("2001:db8:1:2::1"));
    expect(await hash("2001:db8:1:3::1")).not.toBe(await hash("2001:db8:1:2::1"));
    expect(await hash("::ffff:203.0.113.8")).toBe(await hash("203.0.113.8"));
  });
});
