import {expect,test,type Page,type BrowserContext} from '@playwright/test';
import {prepareFixtureUser,waitForAppHydration} from './helpers';
async function providerCalls(context:BrowserContext){
  const response=await context.request.get('/api/test-fixtures/auth-transport');
  expect(response.status()).toBe(200);
  const data=await response.json();expect(data.providerCalls).toEqual(expect.any(Number));return data.providerCalls as number;
}
async function controlledWidget(page:Page,mode:'valid'|'invalid'|'missing'|'wrong-host'|'wrong-action'){
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:
    'window.turnstile={render:function(el,o){const p="google";const m='+JSON.stringify(mode)+';const token=m==="missing"?"":m==="invalid"?"fixture-invalid-"+crypto.randomUUID():"fixture-"+p+"-"+crypto.randomUUID()+(m==="valid"?"":"-"+m);o.callback(token);return p;},reset:function(){},remove:function(){}};'}));
}
for(const provider of ['google','microsoft'] as const){
  const label=provider==='google'?'Continue with Google':'Continue with Microsoft';
  const host=provider==='google'?'accounts.google.com':'login.microsoftonline.com';
  test(provider+' valid challenge reaches controlled identity authorization',async({page,context})=>{
    const before=await providerCalls(context);
    await controlledWidget(page,'valid');
    let calls=0;await page.route('https://'+host+'/**',route=>{calls++;return route.fulfill({contentType:'text/html',body:'Controlled identity authorization'});});
    await page.goto('/sign-in');await waitForAppHydration(page);
    await page.getByRole('button',{name:label,exact:true}).click();
    // The first Auth.js route compiles on demand in the isolated dev server.
    await expect(page).toHaveURL(new RegExp('^https://'+host.replaceAll('.','\\.')+'/'),{timeout:15000});
    expect(calls).toBe(1);
    expect(await providerCalls(context)).toBeGreaterThan(before);
    const cookie=(await context.cookies('http://127.0.0.1:3000/api/auth/callback')).find(c=>c.name==='kairos.auth-attempt.'+(provider==='google'?'google':'microsoft-entra-id'));
    expect(cookie).toMatchObject({httpOnly:true,path:'/api/auth/callback'});
  });
  for(const mode of ['missing','invalid','wrong-host','wrong-action'] as const){
    test(provider+' '+mode+' challenge cannot start identity authorization',async({page,context})=>{
      const before=await providerCalls(context);
      await controlledWidget(page,mode);
      let calls=0;await page.route('https://'+host+'/**',route=>{calls++;return route.abort();});
      await page.goto('/sign-in');await waitForAppHydration(page);
      const button=page.getByRole('button',{name:label,exact:true});
      if(mode==='missing'){
        await expect(button).toBeDisabled();
        await button.evaluate(node=>{const button=node as HTMLButtonElement;button.disabled=false;button.form!.requestSubmit(button);});
      }else await button.click();
      await expect(page.getByRole('alert').filter({hasText:'Complete the verification and try again.'})).toBeVisible();
      await expect(page).toHaveURL(/\/sign-in$/);expect(calls).toBe(0);
      expect(await providerCalls(context)).toBe(before);
    });
  }
}
test('direct identity GET and POST routes cannot bypass public initiation',async({context})=>{
  const before=await providerCalls(context);
  for(const provider of ['google','microsoft-entra-id'])for(const method of ['GET','POST']){
    const response=await context.request.fetch('/api/auth/signin/'+provider,{method,maxRedirects:0,
      ...(method==='POST'?{headers:{origin:'http://127.0.0.1:3000'},form:{'cf-turnstile-response':''}}:{})});
    expect(response.status()).toBe(method==='GET'?405:400);
    expect((await response.json()).code).toBe(method==='GET'?'AUTH_INITIATION_REQUIRES_POST':'AUTH_CHALLENGE_FAILED');
  }
  expect(await providerCalls(context)).toBe(before);
});

test('interactive verification stays above both sign-in buttons on narrow and wide screens',async({page})=>{
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:`
    window.turnstile={render:function(el,o){
      el.style.position='relative';
      const frame=document.createElement('iframe');frame.title='Controlled verification '+o.action;
      frame.style.cssText='position:absolute;top:0;left:0;border:0;width:'+(o.size==='compact'?150:300)+'px;height:'+(o.size==='compact'?140:65)+'px';
      el.append(frame);o.callback('fixture-'+'google'+'-'+crypto.randomUUID());
      return o.action;
    },reset:function(){},remove:function(){}};
  `}));
  for(const width of [320,768]){
    await page.setViewportSize({width,height:900});
    await page.goto('/sign-in');await waitForAppHydration(page);
    for(const provider of ['Google','Microsoft']){
      const button=page.getByRole('button',{name:'Continue with '+provider,exact:true});
      await expect(button).toBeEnabled();
      const frame=button.locator('..').locator('iframe');
      const widgetBounds=await frame.boundingBox(),buttonBounds=await button.boundingBox();
      expect(widgetBounds).not.toBeNull();expect(buttonBounds).not.toBeNull();
      expect(widgetBounds!.y+widgetBounds!.height+8).toBeLessThanOrEqual(buttonBounds!.y);
      expect(widgetBounds!.x).toBeGreaterThanOrEqual(0);
      expect(widgetBounds!.x+widgetBounds!.width).toBeLessThanOrEqual(width);
      expect(await button.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
    }
  }
});

test('one verification serves both identity buttons',async({page})=>{
  await controlledWidget(page,'valid');
  await page.goto('/sign-in');await waitForAppHydration(page);
  await expect(page.locator('form')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Continue with Microsoft',exact:true})).toBeEnabled();
});

test('Open Kairos reuses the session in a new tab',async({context,page})=>{
  await prepareFixtureUser(context);
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Open Kairos',exact:true})).toHaveAttribute('href','/upcoming');
  const next=await context.newPage();
  await next.goto('/');await next.getByRole('link',{name:'Open Kairos',exact:true}).click();
  await expect(next).toHaveURL('http://127.0.0.1:3000/upcoming');
});

test('an existing session bypasses sign-in and retains the safe return path',async({context,page})=>{
  await prepareFixtureUser(context);
  await page.goto('/sign-in?returnTo=/sources');
  await expect(page).toHaveURL('http://127.0.0.1:3000/sources');
});
