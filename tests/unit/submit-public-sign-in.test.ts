import {expect,it,vi} from 'vitest';
import {submitPublicSignIn} from '@/features/auth/submit-public-sign-in';
const data=()=>{const value=new FormData();value.set('cf-turnstile-response','synthetic-token');value.set('returnTo','/settings');return value;};
it('uses actual CSRF and guarded form endpoint before provider navigation',async()=>{
  const request=vi.fn<typeof fetch>(async input=>String(input).endsWith('/csrf')?Response.json({csrfToken:'synthetic-csrf'}):Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state'}));
  const navigate=vi.fn();await submitPublicSignIn('google',data(),{fetch:request,navigate,origin:'https://mykairos.me'});
  expect(request.mock.calls[0][0]).toBe('/api/auth/csrf');expect(request.mock.calls[1][0]).toBe('/api/auth/signin/google');
  const options=request.mock.calls[1][1]!;expect(options.method).toBe('POST');
  const body=new URLSearchParams(options.body as string);expect(body.get('csrfToken')).toBe('synthetic-csrf');expect(body.get('cf-turnstile-response')).toBe('synthetic-token');expect(body.get('callbackUrl')).toBe('/settings');
  expect(navigate).toHaveBeenCalledOnce();
});
it('retains safe challenge failures without any navigation',async()=>{
  const request=vi.fn<typeof fetch>(async input=>String(input).endsWith('/csrf')?Response.json({csrfToken:'synthetic-csrf'}):Response.json({code:'AUTH_CHALLENGE_FAILED',message:'Complete the verification and try again.'},{status:400}));
  const navigate=vi.fn();expect(await submitPublicSignIn('microsoft-entra-id',data(),{fetch:request,navigate,origin:'https://mykairos.me'})).toMatchObject({code:'AUTH_CHALLENGE_FAILED'});expect(navigate).not.toHaveBeenCalled();
});
it('rejects untrusted navigation and suppresses raw failures',async()=>{
  for(const url of ['https://unexpected.invalid/private','javascript:alert(1)']){
    const request:typeof fetch=async input=>String(input).endsWith('/csrf')?Response.json({csrfToken:'synthetic'}):Response.json({url});
    const navigate=vi.fn();expect(await submitPublicSignIn('google',data(),{fetch:request,navigate,origin:'https://mykairos.me'})).toMatchObject({code:'AUTH_FAILED'});expect(navigate).not.toHaveBeenCalled();
  }
});
