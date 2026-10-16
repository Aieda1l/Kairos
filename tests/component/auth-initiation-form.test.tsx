// @vitest-environment jsdom
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AuthInitiationForm} from '@/features/auth/auth-initiation-form';
import type {AuthActionState,IdentityProvider} from '@/lib/auth/initiation';
vi.mock('next/script',()=>({default:({onReady}:{onReady:()=>void})=>{queueMicrotask(onReady);return null;}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('shared managed auth initiation widget',()=>{
  it.each(['google','microsoft-entra-id'] as const)('uses one solved token for the selected %s button and resets after rejection',async provider=>{
    let options:Record<string,unknown>={};const reset=vi.fn(),renderWidget=vi.fn((_element,settings)=>{options=settings;return 'widget';});
    vi.stubGlobal('turnstile',{render:renderWidget,reset,remove:vi.fn()});
    const action=vi.fn<(provider:IdentityProvider,data:FormData)=>Promise<AuthActionState>>().mockResolvedValue({code:'AUTH_CHALLENGE_FAILED',message:'Try verification again.'});
    render(<AuthInitiationForm siteKey="fixture-site" returnTo="/sources" action={action}/>);
    for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();
    await waitFor(()=>expect(options.action).toBe('auth_sign_in'));
    expect(renderWidget).toHaveBeenCalledTimes(1);
    act(()=>(options.callback as (value:string)=>void)('fixture-token'));
    for(const button of screen.getAllByRole('button'))expect(button).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('button',{name:provider==='google'?'Continue with Google':'Continue with Microsoft'}));
    await screen.findByRole('alert');
    expect(action).toHaveBeenCalledTimes(1);expect(action.mock.calls[0][0]).toBe(provider);
    const data=action.mock.calls[0][1];expect(data.get('cf-turnstile-response')).toBe('fixture-token');expect(data.get('returnTo')).toBe('/sources');
    expect(reset).toHaveBeenCalledWith('widget');
    for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();
  });
  it('expires the shared token for both providers',async()=>{
    let options:Record<string,unknown>={};const reset=vi.fn();
    vi.stubGlobal('turnstile',{render:vi.fn((_element,settings)=>{options=settings;return 'widget';}),reset,remove:vi.fn()});
    render(<AuthInitiationForm siteKey="fixture-site" returnTo="/sources"/>);
    await waitFor(()=>expect(options.action).toBe('auth_sign_in'));
    act(()=>(options.callback as (value:string)=>void)('fixture-token'));
    act(()=>(options['expired-callback'] as ()=>void)());
    expect(reset).toHaveBeenCalledWith('widget');
    for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();
  });
});