export type SecretPurpose=
  | "canvas_feed_url"
  | "ed_api_token"
  | "google_refresh_token"
  | "microsoft_refresh_token"
  | "caldav_secret"
  | "oauth_pkce_verifier";

export type CredentialKeyring={
  activeKeyId:string;
  keys:Readonly<Record<string,Uint8Array>>;
};
