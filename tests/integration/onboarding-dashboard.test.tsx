import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {D1OnboardingRepository} from '@/lib/db/d1/repositories/onboarding';
import {AuthenticationRequiredError} from '@/lib/auth/user-scope';
const inputs=vi.hoisted(()=>({path:'/upcoming',runtime:vi.fn()}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({'x-kairos-pathname':inputs.path})}));
vi.mock('next/server',()=>({connection:async()=>{}}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error('REDIRECT '+path);}}));
vi.mock('@/lib/platform/source-runtime',()=>({getSourceRuntimeContext:inputs.runtime}));
let database:ReturnType<typeof openD1TestDatabase>;
beforeEach(()=>{database=openD1TestDatabase();database.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic');");inputs.path='/upcoming';inputs.runtime.mockResolvedValue({db:database.db,scope:{userId:'synthetic'}});});
afterEach(()=>database.close());
it('guards active authenticated pages and leaves onboarding free of a redirect loop',async()=>{
  const {default:Layout}=await import('@/app/(dashboard)/layout');
  await expect(Layout({children:null})).rejects.toThrow('REDIRECT /onboarding');
  inputs.path='/onboarding';expect(await Layout({children:null})).toBeTruthy();
});
it.each(['finish','defer'] as const)('allows %s users to enter dashboard deep links',async type=>{
  const repo=new D1OnboardingRepository(database.db,{userId:'synthetic'});
  await repo.ensureInitialized();await repo.apply({type},0);
  const {default:Layout}=await import('@/app/(dashboard)/layout');
  for(const path of ['/upcoming','/assignments','/calendar','/sources','/settings']){inputs.path=path;expect(await Layout({children:null})).toBeTruthy();}
});
it('fails closed if trusted proxy request forwarding is absent',async()=>{
  const {default:Layout}=await import('@/app/(dashboard)/layout');inputs.path='';await expect(Layout({children:null})).rejects.toThrow('request path is unavailable');
});
it('redirects unauthenticated requests to their validated path before touching repositories',async()=>{
  database.sqlite.exec('DROP TABLE app_settings');inputs.path='/sources';inputs.runtime.mockRejectedValue(new AuthenticationRequiredError());
  const {default:Layout}=await import('@/app/(dashboard)/layout');await expect(Layout({children:null})).rejects.toThrow('REDIRECT /sign-in?returnTo=%2Fsources');
});
