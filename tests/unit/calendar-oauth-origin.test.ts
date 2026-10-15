import {expect,it} from 'vitest';
import {getOAuthRedirectUri} from '@/lib/calendar/local-oauth-origin';
const local={KAIROS_APP_URL:'http://127.0.0.1:3000',KAIROS_LOCAL_AUTH:'loopback',KAIROS_ABUSE_TRUSTED_INGRESS:'loopback'};
it('supports explicitly configured loopback OAuth without disabling origin validation',()=>{
  expect(getOAuthRedirectUri('http://127.0.0.1:3000/api/calendars/google/start','/api/calendars/google/callback',local)).toBe('http://127.0.0.1:3000/api/calendars/google/callback');
});
it.each([
  [local,'http://localhost:3000/start'],
  [{...local,KAIROS_LOCAL_AUTH:undefined},'http://127.0.0.1:3000/start'],
  [{...local,KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare'},'http://127.0.0.1:3000/start'],
  [{...local,KAIROS_APP_URL:'https://mykairos.me'},'https://mykairos.me/start'],
  [{...local,KAIROS_APP_URL:'http://127.0.0.1.evil.invalid:3000'},'http://127.0.0.1.evil.invalid:3000/start'],
])('rejects incompatible or mismatched local OAuth modes',(env,request)=>{
  expect(()=>getOAuthRedirectUri(request,'/api/calendars/google/callback',env)).toThrow();
});
it('preserves the exact hosted callback independently of a request host',()=>{
  expect(getOAuthRedirectUri('https://unexpected.invalid/start','/api/calendars/google/callback',{KAIROS_APP_URL:'https://mykairos.me'})).toBe('https://mykairos.me/api/calendars/google/callback');
});
