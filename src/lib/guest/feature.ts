export function isGuestEnabled(env:Record<string,unknown>):boolean {
  return env.KAIROS_GUEST_ENABLED==="true";
}
