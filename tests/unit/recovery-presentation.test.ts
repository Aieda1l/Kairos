import {afterEach,expect,it,vi} from 'vitest';
import {getRecoveryNotice,recoveryFromResponse,identitySignInFailureMessage,readRecoveryBody} from '@/lib/recovery/presentation';
import {getAccountSummary} from '@/lib/account/account-summary';
import {openD1TestDatabase} from '../helpers/d1-test-db';
const runtime=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('@/lib/platform/source-runtime',()=>({getSourceRuntimeContext:runtime.get}));

it.each(['ABUSE_STORAGE_UNAVAILABLE','ABUSE_CONFIG_INVALID','SERVICE_UNAVAILABLE','CALENDAR_NETWORK_ERROR','ED_UPSTREAM_ERROR','NETWORK_ERROR'])(
  '%s offers retry and retained-data guidance without reconnecting',code=>{
    expect(getRecoveryNotice(code)).toMatchObject({action:'retry',message:expect.stringMatching(/retained|kept/i)});
  },
);
it.each(['CALENDAR_AUTH_EXPIRED','CALENDAR_AUTH_REQUIRED','ED_AUTH_INVALID','UNAUTHORIZED_OR_EXPIRED_FEED'])(
  '%s offers explicit reconnection',code=>expect(getRecoveryNotice(code)?.action).toBe('reconnect'),
);
it('explains missing calendars and requires a deliberate recreation choice',()=>{
  expect(getRecoveryNotice('CALENDAR_REMOTE_CALENDAR_MISSING')).toMatchObject({action:'recreate',href:'/sources',message:expect.stringMatching(/missing.*recreat/i)});
  expect(getRecoveryNotice('CALENDAR_REMOTE_CALENDAR_MISSING')?.message).toMatch(/reconnecting does not recreate/i);
});
it('shows iCloud calendar setup guidance for a rejected connection without exposing provider text',()=>{
  const notice=recoveryFromResponse({code:'CALDAV_NOT_WRITABLE',message:'synthetic-private-Apple-response'},new Response(null,{status:502}),'caldav');
  expect(notice).toMatchObject({key:'caldav',action:'retry',message:expect.stringMatching(/writable.*Kairos.*same Apple account/i)});
  expect(notice?.message).toMatch(/retained/i);
  expect(notice?.message).not.toMatch(/temporarily unavailable|synthetic-private/);
});
it.each(['GRADESCOPE_PARSE_ERROR','ED_PARSE_ERROR','INVALID_ICAL','UNRECOGNIZED_STATUS','INVALID_RESULT','PARTIAL_SYNC','PARTIAL_PARSE'])(
  '%s explains retained data',code=>expect(getRecoveryNotice(code)?.message).toMatch(/previously.*(kept|retained)/i),
);
it('uses the actual AUTH_REQUIRED runtime code without exposing server text',()=>{
  expect(recoveryFromResponse({code:'AUTH_REQUIRED',message:'synthetic-private-marker'})).toMatchObject({action:'sign-in-and-retry',href:'/sign-in'});
});
it.each(['CANVAS_SIGNED_OUT','GRADESCOPE_SIGNED_OUT'])(
  '%s asks for a signed-in tab and retry',code=>expect(getRecoveryNotice(code)).toMatchObject({action:'sign-in-and-retry',message:expect.stringMatching(/sign in.*retry/i)}),
);
it('uses bounded server backoff, including Retry-After, and safe fallback',()=>{
  expect(getRecoveryNotice('RATE_LIMITED',{retryAfterSeconds:99999})?.retryAfterSeconds).toBe(3600);
  expect(getRecoveryNotice('ED_RATE_LIMITED',{retryAfterSeconds:-2})?.retryAfterSeconds).toBe(1);
  expect(getRecoveryNotice('CALENDAR_RATE_LIMITED',{retryAfterSeconds:NaN})?.retryAfterSeconds).toBe(60);
  expect(recoveryFromResponse({code:'RATE_LIMITED'},new Response(null,{status:429,headers:{'Retry-After':'125'}}))?.retryAfterSeconds).toBe(125);
});

it.each([null,'<html>private-marker</html>','{invalid','null','[]'])('retains status/header recovery with unusable body %s',async(body)=>{
  const response=new Response(body,{status:429,headers:{'Retry-After':'99999'}});
  const data=await readRecoveryBody(response);
  expect(data).toEqual({});expect(recoveryFromResponse(data,response)).toMatchObject({action:'retry',retryAfterSeconds:3600});
  expect(recoveryFromResponse(data,new Response(null,{status:401}))).toMatchObject({action:'sign-in-and-retry',href:'/sign-in'});
});

it.each([null,'<html>private-marker</html>','null','[]'])('rejects an unusable successful response body %s without raw text',async(body)=>{
  await expect(readRecoveryBody(new Response(body,{status:200}))).rejects.toMatchObject({notice:{action:'retry',message:expect.stringMatching(/previously saved data was kept/i)}});
});
it('does not imply uncertain work is settled or invite automatic reset/reconnection',()=>{
  const notice=getRecoveryNotice('SYNC_RECOVERY_REQUIRED');
  expect(notice).toMatchObject({href:'/support',message:expect.stringMatching(/prior.*outcome.*support/i)});
  expect(notice?.message).toMatch(/retained/i);
  expect(notice?.action).not.toBe('reconnect');
});
it('ignores unvalidated messages, inherited codes and unknown provider strings',()=>{
  const secret='synthetic-private-marker';
  expect(getRecoveryNotice(secret)).toBeNull();
  expect(recoveryFromResponse({message:secret,code:secret})).toBeNull();
  expect(recoveryFromResponse(Object.create({code:'CALENDAR_AUTH_EXPIRED'}))).toBeNull();
  expect(JSON.stringify(recoveryFromResponse({message:secret},new Response(null,{status:503})))).not.toContain(secret);
});
it('keeps OAuthAccountNotLinked and ordinary sign-in errors identical without association disclosure',()=>{
  expect(identitySignInFailureMessage('OAuthAccountNotLinked')).toBe('Sign-in could not be completed. Please try again.');
  expect(identitySignInFailureMessage('OAuthCallbackError')).toBe(identitySignInFailureMessage('OAuthAccountNotLinked'));
  expect(identitySignInFailureMessage('synthetic-private-email@example.test')).toBe(identitySignInFailureMessage('OAuthAccountNotLinked'));
  expect(identitySignInFailureMessage(null)).toBeNull();
});

let database:ReturnType<typeof openD1TestDatabase>|undefined;
afterEach(()=>database?.close());
it('selects only the scoped identity fields and maps the Microsoft identity provider',async()=>{
  database=openD1TestDatabase();
  database.sqlite.exec(`INSERT INTO users(id,name,email,image) VALUES ('a','Alice','alice@example.test','private-image'),('b','Bob','bob@example.test','other-image');
    INSERT INTO accounts(id,userId,type,provider,providerAccountId,access_token) VALUES ('a-account','a','oauth','microsoft-entra-id','private-provider-id','private-token'),('b-account','b','oauth','google','other-provider-id','other-token');
    INSERT INTO sessions(id,sessionToken,userId,expires) VALUES ('session','private-session','b','2099');`);
  expect(await getAccountSummary(database.db,{userId:'a'})).toEqual({name:'Alice',email:'alice@example.test',identityProvider:'microsoft'});
  expect(await getAccountSummary(database.db,{userId:'b'})).toEqual({name:'Bob',email:'bob@example.test',identityProvider:'google'});
  expect(await getAccountSummary(database.db,{userId:'missing'})).toEqual({name:null,email:null,identityProvider:'unknown'});
});
it('does not infer identity from another user or an unsupported provider',async()=>{
  database=openD1TestDatabase();
  database.sqlite.exec(`INSERT INTO users(id) VALUES ('a'),('b');
    INSERT INTO accounts(id,userId,type,provider,providerAccountId) VALUES ('x','b','oauth','google','private'),('y','a','oauth','calendar-only','private');`);
  expect(await getAccountSummary(database.db,{userId:'a'})).toEqual({name:null,email:null,identityProvider:'unknown'});
});
it('binds the server settings page to its authenticated scope and sends only the minimal summary',async()=>{
  database=openD1TestDatabase();
  database.sqlite.exec(`INSERT INTO users(id,name,email) VALUES ('a','Alice','alice@example.test'),('b','Bob','bob@example.test');
    INSERT INTO accounts(id,userId,type,provider,providerAccountId,access_token) VALUES ('a-account','a','oauth','google','private-account','private-token');`);
  const {default:SettingsPage}=await import('@/app/(dashboard)/settings/page');
  runtime.get.mockResolvedValue({db:database.db,scope:{userId:'a'}});
  const first=await SettingsPage();expect(first.props.account).toEqual({name:'Alice',email:'alice@example.test',identityProvider:'google'});
  runtime.get.mockResolvedValue({db:database.db,scope:{userId:'b'}});
  const second=await SettingsPage();expect(second.props.account).toEqual({name:'Bob',email:'bob@example.test',identityProvider:'unknown'});
  expect(JSON.stringify(second.props)).not.toMatch(/Alice|alice@|private-account|private-token/);
});
it('distinguishes Kairos admission limits from upstream provider throttling',()=>{
  expect(getRecoveryNotice('RATE_LIMITED',{retryAfterSeconds:328})?.message).toMatch(/Kairos.*328 seconds/);
  expect(getRecoveryNotice('RATE_LIMITED',{retryAfterSeconds:328})?.message).not.toMatch(/provider is limiting/i);
  expect(getRecoveryNotice('CALENDAR_RATE_LIMITED',{retryAfterSeconds:328})?.message).toMatch(/provider is limiting/i);
});
