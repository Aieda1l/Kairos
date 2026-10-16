import {beforeEach,expect,it,vi} from 'vitest';
import {AuthenticationRequiredError,requireUserScope} from '@/lib/auth/user-scope';
import {redirect} from 'next/navigation';
import SignInPage from '@/app/sign-in/page';
vi.mock('@/lib/auth/user-scope',async original=>({...await original<object>(),requireUserScope:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:vi.fn((path:string)=>{throw new Error('REDIRECT:'+path);})}));
beforeEach(()=>{vi.mocked(requireUserScope).mockResolvedValue({userId:'synthetic-user'});vi.mocked(redirect).mockClear();});
it('reuses an existing session before showing verification',async()=>{
  await expect(SignInPage({searchParams:Promise.resolve({returnTo:'/sources'})})).rejects.toThrow('REDIRECT:/sources');
  expect(redirect).toHaveBeenCalledWith('/sources');
});
it('uses a dashboard fallback for an unsafe return destination',async()=>{
  await expect(SignInPage({searchParams:Promise.resolve({returnTo:'https://unexpected.invalid/'})})).rejects.toThrow('REDIRECT:/upcoming');
});
it('still renders sign-in for an absent or expired session',async()=>{
  vi.mocked(requireUserScope).mockRejectedValue(new AuthenticationRequiredError());
  await expect(SignInPage({searchParams:Promise.resolve({})})).resolves.toBeDefined();
  expect(redirect).not.toHaveBeenCalled();
});
it('does not hide a session storage failure as a signed-out state',async()=>{
  vi.mocked(requireUserScope).mockRejectedValue(new Error('synthetic-storage-failure'));
  await expect(SignInPage({searchParams:Promise.resolve({})})).rejects.toThrow('synthetic-storage-failure');
});
