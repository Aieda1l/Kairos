// Auth.js provider errors can include codes, tokens, email addresses, and
// full provider responses. Only emit known, fixed error categories to logs.
const PROVIDER_ERRORS = new Set([
  "invalid_client",
  "unauthorized_client",
  "invalid_grant",
  "invalid_scope",
  "invalid_request",
  "access_denied",
  "interaction_required",
  "consent_required",
  "temporarily_unavailable",
]);

const AUTH_ERRORS = new Set([
  "OAuthCallbackError",
  "OAuthAccountNotLinked",
  "OAuthProfileParseError",
  "CallbackRouteError",
  "AdapterError",
  "AccessDenied",
  "Configuration",
  "MissingSecret",
  "InvalidCheck",
]);

function providerError(value:unknown):string{
  return typeof value==="string"&&PROVIDER_ERRORS.has(value)
    ?value
    :"other";
}

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"
    ?value as Record<string,unknown>
    :null;
}

export const authDiagnostics={
  error(error:Error):void{
    const type=record(error)?.type;
    const category=typeof type==="string"&&AUTH_ERRORS.has(type)
      ?type
      :"OtherAuthError";
    // For Microsoft token responses Auth.js includes a provider code in the
    // message. Match a fixed prefix and allowlist; never log the message.
    const match=category==="OAuthCallbackError"
      ?/^OAuth Provider returned an error: ([a-z_]+)(?:\b|$)/.exec(error.message)
      :null;
    console.warn("Kairos sign-in failed",{
      category,
      providerCode:providerError(match?.[1]),
    });
  },
  debug(message:string,metadata?:unknown):void{
    // Auth.js also sends access tokens and full user profiles to debug().
    // Ignore every event except the rejected OAuth authorization response.
    if(message!=="OAuthCallbackError")return;
    const details=record(metadata);
    console.warn("Kairos sign-in authorization rejected",{
      provider:details?.providerId==="microsoft-entra-id"
        ?"microsoft-entra-id"
        :details?.providerId==="google"?"google":"other",
      providerCode:providerError(details?.error),
    });
  },
};
