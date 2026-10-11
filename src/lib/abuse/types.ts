import type {D1DatabaseLike} from "@/lib/db/d1/types";

export type IdentityProvider="google"|"microsoft-entra-id";
export type SourceProvider="canvas"|"gradescope"|"ed";
export type CalendarProvider="google"|"microsoft"|"caldav";
export type IntegrationProvider=SourceProvider|CalendarProvider;
export type ControlKey="auth:initiation"|`auth:${IdentityProvider}`|`provider:${IntegrationProvider}`;
export type TrustedIngress="none"|"cloudflare";

// Callers must authenticate and authorize these actors/resources before admission.
// No body/header supplied identity, resource, ingress mode, or budget is trusted.
export type RateSubject=
  |{class:"auth-initiation";provider:IdentityProvider;network:string}
  |{class:"credential";userId:string;provider:IntegrationProvider}
  |{class:"source-sync";userId:string;provider:SourceProvider;resourceId:string}
  |{class:"calendar-sync";userId:string;provider:CalendarProvider;resourceId:string}
  |{class:"sync-all";userId:string}
  |{class:"deletion";userId:string};
export type RateClass=RateSubject["class"];
export type RateBudget=Readonly<{limit:number;windowSeconds:number}>;
export type AbusePolicy=Readonly<Record<RateClass,RateBudget>>;
export type RateDecision={allowed:true}|{allowed:false;retryAfterSeconds:number};
export type AbuseRuntime={
  db:D1DatabaseLike;
  hmacKey:Uint8Array;
  turnstileSecret:string;
  appOrigin:string;
  hostname:string;
  fetchImpl:typeof fetch;
  // Optional for the base contract; the environment resolver always supplies both.
  policy?:AbusePolicy;
  trustedIngress?:TrustedIngress;
};

export function boundedRetryAfter(seconds:number):number{
  return Number.isFinite(seconds)?Math.max(1,Math.min(3600,Math.ceil(seconds))):60;
}

export class RateLimitedError extends Error{
  readonly code="RATE_LIMITED";
  readonly retryAfterSeconds:number;
  constructor(seconds:number){
    super("Too many attempts. Try again later.");
    this.name="RateLimitedError";
    this.retryAfterSeconds=boundedRetryAfter(seconds);
  }
}
export class AbuseStorageUnavailableError extends Error{
  readonly code="ABUSE_STORAGE_UNAVAILABLE";
  constructor(){super("Abuse protection storage is unavailable.");this.name="AbuseStorageUnavailableError";}
}
export class AbuseConfigurationError extends Error{
  readonly code="ABUSE_CONFIG_INVALID";
  constructor(){super("Abuse protection configuration is invalid.");this.name="AbuseConfigurationError";}
}
export class AbuseClientAddressError extends Error{
  readonly code="ABUSE_CLIENT_ADDRESS_INVALID";
  constructor(){super("Trusted client address is unavailable.");this.name="AbuseClientAddressError";}
}
export class AbuseSubjectError extends Error{
  readonly code="ABUSE_SUBJECT_INVALID";
  constructor(){super("Abuse protection subject is invalid.");this.name="AbuseSubjectError";}
}
