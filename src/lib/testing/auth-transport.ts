import 'server-only';
const transports=new WeakMap<object,typeof fetch>();
const counters=new WeakMap<object,{siteverifyCalls:number;providerCalls:number}>();
export function isLocalFixtureEnvironment(env:Record<string,unknown>):boolean{
  if(env.E2E_FIXTURES!=='1'||env.KAIROS_LOCAL_AUTH!=='loopback'||env.KAIROS_ABUSE_TRUSTED_INGRESS!=='loopback')return false;
  let origin:URL;
  try{origin=new URL(String(env.KAIROS_APP_URL));}catch{return false;}
  return origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)&&origin.origin===env.KAIROS_APP_URL;
}
/** Controlled transport only: real token/action/hostname validation remains in verifyTurnstile. */
export function localAuthFixtureFetch(env:Record<string,unknown>):typeof fetch|undefined{
  if(!isLocalFixtureEnvironment(env))return undefined;
  const origin=new URL(String(env.KAIROS_APP_URL));
  const prior=transports.get(env);if(prior)return prior;
  const counts={siteverifyCalls:0,providerCalls:0};
  const spent=new Set<string>();
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
      counts.siteverifyCalls++;
      const text=init?.body instanceof URLSearchParams?init.body.toString():typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
      const params=new URLSearchParams(text),token=params.get('response')??'',secret=params.get('secret');
      if((init?.method??(input instanceof Request?input.method:'GET'))!=='POST'||!['synthetic-secret','1x0000000000000000000000000000000AA'].includes(secret??'')||spent.has(token)||!/^fixture-(google|microsoft)(?:$|-)/.test(token))return Response.json({success:false});
      spent.add(token);
      const google=token.startsWith('fixture-google'),wrongHost=token.endsWith('-wrong-host'),wrongAction=token.endsWith('-wrong-action');
      return Response.json({success:true,hostname:wrongHost?'unexpected.invalid':origin.hostname,action:wrongAction?'unexpected':google?'auth_google':'auth_microsoft'});
    }
    counts.providerCalls++;
    if(url.href==='https://accounts.google.com/.well-known/openid-configuration')return Response.json({
      issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint:'https://oauth2.googleapis.com/token',userinfo_endpoint:'https://openidconnect.googleapis.com/v1/userinfo',
      jwks_uri:'https://www.googleapis.com/oauth2/v3/certs',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256'],
    });
    if(url.href==='https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration')return Response.json({
      issuer:'https://login.microsoftonline.com/common/v2.0',authorization_endpoint:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      token_endpoint:'https://login.microsoftonline.com/common/oauth2/v2.0/token',jwks_uri:'https://login.microsoftonline.com/common/discovery/v2.0/keys',
      response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256'],
    });
    throw new Error('Unexpected local auth fixture request.');
  };
  transports.set(env,transport);counters.set(env,counts);return transport;
}
/** Counts only, available under the identical local fixture gate as the transport. */
export function localAuthFixtureStats(env:Record<string,unknown>){
  if(!localAuthFixtureFetch(env))return undefined;
  return {...counters.get(env)!};
}
