/** Shared by connection, sync and saved-candidate recovery consumers. */
export function providerRecoveryMessage(body:unknown):string|null{
  if(!body||typeof body!=="object")return null;
  const {code,retryAfterSeconds}=body as {code?:unknown;retryAfterSeconds?:unknown};
  switch(code){
    case "RATE_LIMITED":{
      const seconds=typeof retryAfterSeconds==="number"&&Number.isFinite(retryAfterSeconds)
        ?Math.max(1,Math.min(3600,Math.ceil(retryAfterSeconds))):60;
      return `Too many attempts. Try again in ${seconds} seconds.`;
    }
    case "ABUSE_STORAGE_UNAVAILABLE":case "ABUSE_CONFIG_INVALID":
      return "This service is temporarily unavailable. Your accepted connections and data are retained. Try again later.";
    case "PROVIDER_AUTHORIZATION_CHANGED":
      return "Provider authorization changed. Start a new connection or sync attempt.";
    case "SYNC_IN_PROGRESS":return "Provider work is already running. Wait for it to finish.";
    case "SYNC_RECOVERY_REQUIRED":
      return "Prior provider work needs recovery. Your accepted connections and data are retained. Confirm the prior outcome before retrying.";
    default:return null;
  }
}
