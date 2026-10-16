export type RecoveryNotice={key:string;message:string;action:'connect'|'verify-extension'|'sign-in-and-retry'|'retry'|'reconnect'|'recreate';href?:string;retryAfterSeconds?:number};
import {boundedRetryAfter} from '@/lib/abuse/types';

/** Only fixed, recognized codes choose presentation. Never display response messages. */
export function getRecoveryNotice(code:unknown,options:{key?:string;retryAfterSeconds?:unknown}={}):RecoveryNotice|null{
  if(typeof code!=='string')return null;
  const key=options.key??code;
  const notice=(message:string,action:RecoveryNotice['action'],href?:string):RecoveryNotice=>({key,message,action,...(href?{href}:{})});
  switch(code){
    case 'ABUSE_STORAGE_UNAVAILABLE':case 'ABUSE_CONFIG_INVALID':case 'SERVICE_UNAVAILABLE':
    case 'ONBOARDING_UNAVAILABLE':case 'NETWORK_ERROR':case 'CALENDAR_NETWORK_ERROR':
    case 'CALENDAR_UPSTREAM_ERROR':case 'ED_NETWORK_ERROR':case 'ED_UPSTREAM_ERROR':
    case 'CANVAS_NETWORK_ERROR':case 'GRADESCOPE_NETWORK_ERROR':
    case 'SYNC_FAILED':
      return notice('This service is temporarily unavailable. Your accepted connections and data are retained. Retry later.','retry');
    case 'CALENDAR_AUTH_EXPIRED':case 'CALENDAR_AUTH_REQUIRED':case 'ED_AUTH_INVALID':
    case 'UNAUTHORIZED_OR_EXPIRED_FEED':
      return notice('The saved authorization has expired or was rejected. Reconnect this connection; previously saved data is kept.','reconnect','/sources');
    case 'CALENDAR_REMOTE_CALENDAR_MISSING':
      return notice('The remote Kairos calendar is missing. Review destination recovery before explicitly choosing recreation; reconnecting does not recreate it. Saved coursework and event mappings are retained. For iCloud, a replacement must be writable and named Kairos. Contact support to confirm safe replacement.','recreate','/sources');
    case 'INVALID_ICAL':case 'GRADESCOPE_PARSE_ERROR':case 'ED_PARSE_ERROR':
    case 'UNRECOGNIZED_STATUS':case 'INVALID_RESULT':case 'PARTIAL_SYNC':case 'PARTIAL_PARSE':
      return notice('Some source data could not be recognized or updated. Previously saved data was kept. Retry later; contact support if this continues.','retry');
    case 'EXTENSION_TIMEOUT':
      return notice('Firefox extension timed out. Previously saved data was kept. Retry later.','retry');
    case 'CANVAS_SIGNED_OUT':
      return notice('Sign in to Canvas, then retry. Keep the Canvas tab open in Firefox. Previously saved data was kept.','sign-in-and-retry');
    case 'CANVAS_TAB_UNAVAILABLE':
      return notice('Open Canvas in Firefox, then try again. Sign in to Canvas before retrying. Previously saved data was kept.','sign-in-and-retry');
    case 'GRADESCOPE_SIGNED_OUT':
      return notice('Sign in to Gradescope, then retry. Keep the Gradescope tab open in Firefox. Previously saved data was kept.','sign-in-and-retry');
    case 'GRADESCOPE_TAB_UNAVAILABLE':
      return notice('Open Gradescope in Firefox, then try again. Sign in to Gradescope before retrying. Previously saved data was kept.','sign-in-and-retry');
    case 'AUTH_REQUIRED':case 'AUTHENTICATION_REQUIRED':
      return notice('Sign in to Kairos again, then retry your action.','sign-in-and-retry','/sign-in');
    case 'EXTENSION_UNAVAILABLE':
      return notice('Firefox extension not detected. Verify it for your enabled browser features. The public add-on listing is pending review.','verify-extension','/settings');
    case 'RATE_LIMITED':case 'ED_RATE_LIMITED':case 'CALENDAR_RATE_LIMITED':case 'HTTP_429':{
      const seconds=boundedRetryAfter(typeof options.retryAfterSeconds==='number'?options.retryAfterSeconds:NaN);
      const message=code==='RATE_LIMITED'?`Kairos is limiting repeated requests. Try again in ${seconds} seconds. Saved data is retained.`
        :code==='HTTP_429'?`Requests are temporarily limited. Try again in ${seconds} seconds. Saved data is retained.`
          :`The provider is limiting requests. Try again in ${seconds} seconds. Saved data is retained.`;
      return {...notice(message,'retry'),retryAfterSeconds:seconds};
    }
    case 'SYNC_RECOVERY_REQUIRED':
      return notice('Prior provider work has an uncertain outcome. Your accepted connections and data are retained. Confirm the prior outcome through recovery and support before retrying. Waiting alone does not settle it.','retry','/support');
    case 'SYNC_IN_PROGRESS':
      return {...notice('Provider work is already running. Wait for it to finish before retrying.','retry'),retryAfterSeconds:60};
    case 'PROVIDER_AUTHORIZATION_CHANGED':
      return notice('Provider authorization changed during this attempt. Saved data is retained. Review the connection and start a fresh attempt.','retry','/sources');
    case 'CALENDAR_PERMISSION_DENIED':case 'CALENDAR_CONFIG_MISSING':
      return notice('Calendar access is unavailable. Review calendar consent and mailbox access; contact support if access remains unavailable. Saved data is retained.','retry','/support');
    case 'ED_COURSE_UNAVAILABLE':case 'GRADESCOPE_COURSE_UNAVAILABLE':
      return notice('A selected course is unavailable. Review your course selection. Previously saved data was kept.','retry','/sources');
    default:return null;
  }
}

export function recoveryFromResponse(body:unknown,response?:Response,key?:string):RecoveryNotice|null{
  const data=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
  const rawSeconds=Object.hasOwn(data,'retryAfterSeconds')?data.retryAfterSeconds:undefined;
  const header=response?.headers.get('Retry-After');
  const retryAfterSeconds=typeof rawSeconds==='number'?rawSeconds:header&&/^\d+$/.test(header)?Number(header):undefined;
  for(const field of ['code','errorCode','lastErrorCode']){
    const found=Object.hasOwn(data,field)?getRecoveryNotice(data[field],{key,retryAfterSeconds}):null;
    if(found)return found;
  }
  const fallback=response?.status===429?'RATE_LIMITED':response?.status===401?'AUTHENTICATION_REQUIRED':response&&response.status>=500?'SERVICE_UNAVAILABLE':null;
  return getRecoveryNotice(fallback,{key,retryAfterSeconds});
}

/** Error bodies are optional; HTTP status and Retry-After still carry recovery. */
export async function readRecoveryBody(response:Response):Promise<Record<string,unknown>>{
  let body:unknown;
  try{body=await response.json();}catch{/* HTTP failures may have no JSON body. */}
  if(body&&typeof body==='object'&&!Array.isArray(body))return body as Record<string,unknown>;
  if(response.ok)throw new RecoveryRequestError(getRecoveryNotice('INVALID_RESULT'),'The service returned an invalid result.');
  return {};
}

export class RecoveryRequestError extends Error{
  constructor(readonly notice:RecoveryNotice|null,fallback:string){super(notice?.message??fallback);}
}
export function identitySignInFailureMessage(error:unknown):string|null{
  return error?'Sign-in could not be completed. Please try again.':null;
}
