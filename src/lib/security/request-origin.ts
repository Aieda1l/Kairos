import {AbuseConfigurationError} from "@/lib/abuse/types";

export class RequestOriginError extends Error{
  readonly code="UNTRUSTED_ORIGIN";
  constructor(){super("This request must originate from Kairos.");}
}

export function isLoopbackOrigin(url:URL):boolean{
  return ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
}

/** Explicit server-selected local mode cannot be combined with a hosted origin. */
export function canonicalAppOrigin(env:Record<string,unknown>):URL{
  try{
    if(typeof env.KAIROS_APP_URL!=="string")throw new AbuseConfigurationError();
    const url=new URL(env.KAIROS_APP_URL);
    if(url.username||url.password||url.origin!==env.KAIROS_APP_URL)throw new AbuseConfigurationError();
    const local=env.KAIROS_LOCAL_AUTH==="loopback";
    if(env.KAIROS_LOCAL_AUTH!==undefined&&env.KAIROS_LOCAL_AUTH!==""&&!local)throw new AbuseConfigurationError();
    if(local&&(!isLoopbackOrigin(url)||env.KAIROS_ABUSE_TRUSTED_INGRESS!=="loopback"))throw new AbuseConfigurationError();
    if(!local&&url.protocol!=="https:")throw new AbuseConfigurationError();
    if(url.protocol!=="https:"&&!(local&&url.protocol==="http:"))throw new AbuseConfigurationError();
    return url;
  }catch{throw new AbuseConfigurationError();}
}

export function enforceRequestOrigin(headers:Headers,expectedOrigin:string):void{
  if(headers.get("origin")!==expectedOrigin||headers.get("sec-fetch-site")==="cross-site")throw new RequestOriginError();
  const canonical=new URL(expectedOrigin);
  // Headers never select the origin. Reject conflicting hints that Auth.js actions
  // otherwise use to construct their authorization/callback URL.
  for(const name of ["host","x-forwarded-host"]){
    const value=headers.get(name);
    if(value!==null&&value!==canonical.host)throw new RequestOriginError();
  }
  const protocol=headers.get("x-forwarded-proto");
  if(protocol!==null&&protocol!==canonical.protocol.slice(0,-1))throw new RequestOriginError();
}
