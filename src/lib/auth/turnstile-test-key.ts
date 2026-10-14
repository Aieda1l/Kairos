/** Public Cloudflare test-key patterns plus the isolated harness's fixed values. */
export function isKnownTurnstileTestKey(value:unknown):boolean{
  return typeof value==='string'&&(/^[123]x0+(?:AA|AB|BB|FF)$/.test(value.trim())
    ||value.trim()==='synthetic-site'||value.trim()==='synthetic-secret');
}
