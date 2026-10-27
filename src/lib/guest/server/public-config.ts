import "server-only";

/** Call after the guest feature gate. Never resolve account, abuse, or source runtime for a public key. */
export async function getGuestPublicSiteKey():Promise<string>{
  if(process.env.KAIROS_NEXT_COMPAT_BUILD==="1")return "";
  const {env}=await import("cloudflare:workers");
  const key=(env as unknown as Record<string,unknown>).KAIROS_TURNSTILE_SITE_KEY;
  return typeof key==="string"?key:"";
}
