import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {createAuthConfig} from '@/lib/auth/config';
import {openD1TestDatabase} from '../helpers/d1-test-db';

type Login=(token:string|undefined,profile:Record<string,unknown>,account:Record<string,unknown>,options:Record<string,unknown>)=>Promise<{
 user:{id:string};session:{userId:string;expires:Date};
}>;
// Exercise the locked callback's actual linking decision, rather than reproducing
// its logic in a mock. No provider request or credential exchange is performed.
const {handleLoginOrRegister:login}=await import(/* @vite-ignore */ pathToFileURL(path.resolve(
 'node_modules/@auth/core/lib/actions/callback/handle-login.js',
)).href) as {handleLoginOrRegister:Login};

function fixture(){
 const database=openD1TestDatabase();
 database.sqlite.prepare('INSERT INTO users(id,name,email) VALUES (?,?,?)').run('original-user','Original user','original@example.invalid');
 const config=createAuthConfig(database.db as never,{
  AUTH_SECRET:'dummy-session-expiry-secret',AUTH_GOOGLE_ID:'dummy-google',AUTH_GOOGLE_SECRET:'dummy-google-secret',
  AUTH_MICROSOFT_ENTRA_ID_ID:'dummy-microsoft',AUTH_MICROSOFT_ENTRA_ID_SECRET:'dummy-microsoft-secret',
 });
 const options={adapter:config.adapter,jwt:{},events:{},provider:{account:()=>({})},
  session:{strategy:'database',maxAge:3600,generateSessionToken:()=>crypto.randomUUID()}};
 return {...database,adapter:config.adapter!,options};
}
const profile={name:'Independent provider user',email:'independent@example.invalid',emailVerified:null};

it.each(['google','microsoft-entra-id'])('an expired bearer cannot link a new %s identity to its former owner',async provider=>{
 const {adapter,options,sqlite,close}=fixture();
 try{
  const expired='dummy-expired-session';
  await adapter.createSession!({sessionToken:expired,userId:'original-user',expires:new Date(Date.now()-60000)});
  const account={provider,type:'oidc',providerAccountId:'independent-provider-subject'};
  await login(expired,profile,account,options);
  const nextLogin=await login(undefined,profile,account,options);
  expect(nextLogin.user.id).not.toBe('original-user');
  expect(nextLogin.session.userId).toBe(nextLogin.user.id);
  expect(nextLogin.session.expires.getTime()).toBeGreaterThan(Date.now());
  expect(sqlite.prepare('SELECT userId FROM accounts WHERE provider=? AND providerAccountId=?').get(provider,account.providerAccountId))
   .toEqual({userId:nextLogin.user.id});
 }finally{close();}
});

it('preserves explicitly authenticated account linking with an unexpired session',async()=>{
 const {adapter,options,close}=fixture();
 try{
  const token='dummy-current-session';
  await adapter.createSession!({sessionToken:token,userId:'original-user',expires:new Date(Date.now()+60000)});
  const account={provider:'google',type:'oidc',providerAccountId:'independent-provider-subject'};
  expect((await login(token,profile,account,options)).user.id).toBe('original-user');
  expect(await adapter.getUserByAccount!({provider:account.provider,providerAccountId:account.providerAccountId})).toMatchObject({id:'original-user'});
 }finally{close();}
});
