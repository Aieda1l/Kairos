import {describe,it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {unstable_doesMiddlewareMatch} from 'next/experimental/testing/server';
import {proxy,config} from '@/proxy';
import * as entry from '@/lib/onboarding/entry';
import {createOnboardingState} from '@/lib/onboarding/state';
describe('dashboard entry',()=>{
  it.each(['/upcoming','/assignments','/calendar','/sources','/settings'])('guards authenticated active deep link %s',path=>{
    expect(entry.resolveDashboardEntry(createOnboardingState(),path)).toBe('/onboarding');
    for(const status of ['completed','deferred'] as const)expect(entry.resolveDashboardEntry({...createOnboardingState(),status},path)).toBeNull();
    expect(unstable_doesMiddlewareMatch({config,url:'https://mykairos.me'+path})).toBe(true);
  });
  it('never loops at onboarding or blocks ordinary APIs',()=>{
    expect(entry.resolveDashboardEntry(createOnboardingState(),'/onboarding')).toBeNull();
    expect(entry.resolveDashboardEntry(createOnboardingState(),'/api/settings/onboarding')).toBeNull();
    expect(unstable_doesMiddlewareMatch({config,url:'https://mykairos.me/onboarding'})).toBe(true);
  });
  it('overwrites spoofed request headers instead of reflecting a client guard bypass',()=>{
    const response=proxy(new NextRequest('https://mykairos.me/upcoming',{headers:{'x-kairos-pathname':'/onboarding'}}));
    expect(response.headers.get('x-middleware-request-x-kairos-pathname')).toBe('/upcoming');
    expect(response.headers.get('x-middleware-override-headers')).toContain('x-kairos-pathname');
  });
});
