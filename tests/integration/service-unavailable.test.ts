import {afterEach,expect,it,vi} from 'vitest';
import {AuthenticationRequiredError} from '@/lib/auth/user-scope';
import {CredentialKeyConfigurationError} from '@/lib/security/credential-cipher';
const faults=vi.hoisted(()=>({source:vi.fn(),calendar:vi.fn()}));
vi.mock('@/lib/platform/source-runtime',()=>({getSourceRuntimeContext:faults.source}));
vi.mock('@/lib/platform/calendar-runtime',()=>({getCalendarRouteRuntime:faults.calendar}));
import {resolveSourceApiRuntime} from '@/lib/platform/source-api-runtime';
import {resolveCalendarApiRuntime} from '@/lib/platform/calendar-api-runtime';
import {abuseErrorResponse} from '@/lib/abuse/guard';
vi.mock('@/lib/operations/events',()=>({emitOperationEvent:vi.fn()}));
import {emitOperationEvent} from '@/lib/operations/events';
afterEach(()=>vi.clearAllMocks());
it.each(['source','calendar'] as const)('maps invalid encryption bindings to a safe 503 for %s',async kind=>{
  faults[kind].mockRejectedValue(new CredentialKeyConfigurationError('SYNTHETIC_PRIVATE_configuration'));
  const result=await (kind==='source'?resolveSourceApiRuntime():resolveCalendarApiRuntime());
  expect(result.ok).toBe(false);if(result.ok)throw new Error('Expected service failure');
  expect(result.response.status).toBe(503);
  expect(await result.response.json()).toEqual({code:'SERVICE_UNAVAILABLE',message:'Kairos is temporarily unavailable. Try again shortly.'});
});
it('maps a D1 failure after runtime resolution to safe service recovery',async()=>{
  const response=abuseErrorResponse(new Error('D1_ERROR: write quota; SYNTHETIC_PRIVATE_payload'));
  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({code:'SERVICE_UNAVAILABLE',message:'Kairos is temporarily unavailable. Try again shortly.'});
});
it.each(['source','calendar'] as const)('quota_failure_is_service_unavailable_without_reconnect for %s',async kind=>{
  faults[kind].mockRejectedValue(new Error('D1_ERROR: exceeded maximum allowed reads; SYNTHETIC_PRIVATE_binding'));
  const result=await (kind==='source'?resolveSourceApiRuntime():resolveCalendarApiRuntime());
  expect(result.ok).toBe(false);if(result.ok)throw new Error('Expected service failure');
  expect(result.response.status).toBe(503);
  expect(await result.response.json()).toEqual({code:'SERVICE_UNAVAILABLE',message:'Kairos is temporarily unavailable. Try again shortly.'});
  expect(result.response.headers.get('Cache-Control')).toBe('no-store');
});
it.each(['source','calendar'] as const)('preserves authentication and framework redirect control flow for %s',async kind=>{
  const resolve=kind==='source'?resolveSourceApiRuntime:resolveCalendarApiRuntime;
  faults[kind].mockRejectedValueOnce(new AuthenticationRequiredError());
  const result=await resolve();expect(result.ok).toBe(false);if(!result.ok)expect(result.response.status).toBe(401);
  const redirect=Object.assign(new Error('NEXT_REDIRECT'),{digest:'NEXT_REDIRECT;replace;/sign-in;307;'});
  faults[kind].mockRejectedValueOnce(redirect);await expect(resolve()).rejects.toBe(redirect);
  const wrapped=new Error('D1_ERROR: wrapped control flow',{cause:redirect});
  faults[kind].mockRejectedValueOnce(wrapped);await expect(resolve()).rejects.toBe(wrapped);
  const bug=new Error('Synthetic unrelated bug');faults[kind].mockRejectedValueOnce(bug);await expect(resolve()).rejects.toBe(bug);
  expect(emitOperationEvent).not.toHaveBeenCalledWith(expect.anything(),expect.objectContaining({code:'SERVICE_UNAVAILABLE'}));
});
