import 'server-only';
import {ProductionConfigError} from '@/lib/platform/production-config';
import {AbuseConfigurationError,AbuseStorageUnavailableError} from '@/lib/abuse/types';

function value(error:unknown,key:string):unknown{
  if(!error||typeof error!=='object')return undefined;
  try{return Object.getOwnPropertyDescriptor(error,key)?.value;}catch{return undefined;}
}
function causes(error:unknown):unknown[]{
  const chain:unknown[]=[];
  while(error&&chain.length<3&&!chain.includes(error)){chain.push(error);error=value(error,'cause');}
  return chain;
}
export function isFrameworkControlFlow(error:unknown):boolean{
  return causes(error).some(cause=>{
    const digest=value(cause,'digest');
    return typeof digest==='string'&&/^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)(;|$)/.test(digest);
  });
}
export function isServiceUnavailable(error:unknown):boolean{
  if(isFrameworkControlFlow(error))return false;
  for(const cause of causes(error)){
    error=cause;
    if(error instanceof ProductionConfigError||error instanceof AbuseConfigurationError||error instanceof AbuseStorageUnavailableError)return true;
    const code=value(error,'code'),message=value(error,'message');
    if(typeof code==='string'&&['D1_ERROR','D1_EXEC_ERROR','D1_BATCH_ERROR','SQLITE_BUSY','SQLITE_FULL','SQLITE_IOERR','SQLITE_CANTOPEN'].includes(code))return true;
    if(typeof message==='string'&&/^(D1_(ERROR|EXEC_ERROR|BATCH_ERROR):|KAIROS_CREDENTIAL_KEY_V1 )/.test(message.slice(0,128)))return true;
  }
  return false;
}
export function serviceUnavailableResponse():Response{
  return Response.json({code:'SERVICE_UNAVAILABLE',message:'Kairos is temporarily unavailable. Try again shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});
}
