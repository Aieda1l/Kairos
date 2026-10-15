import type {AuthActionState,IdentityProvider} from '@/lib/auth/initiation';
import {safeReturnTo} from '@/lib/auth/return-to';
const messages:Record<string,string>={
  AUTH_CHALLENGE_FAILED:'Complete the verification and try again.',
  AUTH_CHALLENGE_UNAVAILABLE:'Verification is temporarily unavailable. Try again later.',
  AUTH_INITIATION_PAUSED:'Sign-in is temporarily unavailable. Try again later.',
  RATE_LIMITED:'Too many sign-in attempts. Wait before trying again.',
  SERVICE_UNAVAILABLE:'Sign-in is temporarily unavailable. Try again later.',
};
const failed=():AuthActionState=>({code:'AUTH_FAILED',message:'Sign-in could not be completed. Please try again.'});
export async function submitPublicSignIn(provider:IdentityProvider,data:FormData,deps:{fetch:typeof fetch;navigate:(url:string)=>void;origin:string}):Promise<AuthActionState>{
  try{
    if(provider!=='google'&&provider!=='microsoft-entra-id')return failed();
    const tokens=data.getAll('cf-turnstile-response');
    if(tokens.length!==1||typeof tokens[0]!=='string'||!tokens[0]||tokens[0].length>2048)return {code:'AUTH_CHALLENGE_FAILED',message:messages.AUTH_CHALLENGE_FAILED};
    const csrf=await deps.fetch('/api/auth/csrf',{cache:'no-store'}),csrfBody=await csrf.json();
    if(!csrf.ok||typeof csrfBody.csrfToken!=='string'||!csrfBody.csrfToken||csrfBody.csrfToken.length>4096)return failed();
    const returnTo=data.get('returnTo');
    const response=await deps.fetch('/api/auth/signin/'+provider,{method:'POST',cache:'no-store',headers:{
      'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1',
    },body:new URLSearchParams({csrfToken:csrfBody.csrfToken,'cf-turnstile-response':tokens[0],callbackUrl:safeReturnTo(typeof returnTo==='string'?returnTo:null)}).toString()});
    const body=await response.json();
    if(!response.ok){
      const code=typeof body.code==='string'&&Object.hasOwn(messages,body.code)?body.code:'AUTH_FAILED';
      return {code,message:messages[code]??failed().message,...(Number.isInteger(body.retryAfterSeconds)&&body.retryAfterSeconds>=1&&body.retryAfterSeconds<=3600?{retryAfterSeconds:body.retryAfterSeconds}:{})};
    }
    if(typeof body.url!=='string'||body.url.length>8192)return failed();
    const destination=new URL(body.url,deps.origin),expected=provider==='google'?'https://accounts.google.com':'https://login.microsoftonline.com';
    if(destination.username||destination.password||(destination.origin!==deps.origin&&destination.origin!==expected))return failed();
    deps.navigate(destination.href);return {code:'AUTH_REQUIRED',message:'Opening identity authorization.'};
  }catch{return failed();}
}
