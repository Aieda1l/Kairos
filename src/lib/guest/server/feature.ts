import "server-only";
import {isGuestEnabled} from "../feature";

export async function getGuestEnabled():Promise<boolean> {
  if(process.env.KAIROS_NEXT_COMPAT_BUILD==="1")return false;
  const {env}=await import("cloudflare:workers");
  return isGuestEnabled(env as unknown as Record<string,unknown>);
}
