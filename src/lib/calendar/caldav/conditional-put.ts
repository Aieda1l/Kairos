import 'server-only';

/** Only a pinned Kairos resource with a strong HTTP precondition may be retried. */
export function conditionalCaldavPut(input:RequestInfo|URL,init?:RequestInit):{url:string;body:string;condition:string}|null{
  if((init?.method??'GET').toUpperCase()!=='PUT'||typeof init?.body!=='string')return null;
  let url:URL;
  try{url=new URL(input instanceof Request?input.url:String(input));}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash
    ||! /^(?:p\d+-)?caldav\.icloud\.com$/.test(url.hostname)
    ||! /\/[a-f0-9]{64}\.ics$/.test(url.pathname))return null;
  const headers=new Headers(init.headers),none=headers.get('if-none-match'),match=headers.get('if-match');
  if(none==='*'&&match===null)return {url:url.href,body:init.body,condition:'absent'};
  if(none===null&&match!==null&&/^"[!#-\x7e\x80-\xff]*"$/.test(match))return {url:url.href,body:init.body,condition:match};
  return null;
}
