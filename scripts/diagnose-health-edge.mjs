// Temporary bounded, credential-free diagnostic; never print response content.
for (const [label, agent] of [['default', null], ['identified', 'Kairos-Health/1.0 (+https://mykairos.me)'], ['compatible', 'Mozilla/5.0 (compatible; Kairos-Health/1.0; +https://mykairos.me)']]) {
  try {
    const response = await fetch('https://mykairos.me/api/health', {redirect:'manual', signal:AbortSignal.timeout(10000), headers:{accept:'application/json', ...(agent ? {'user-agent':agent} : {})}});
    const reader=response.body.getReader(); let text='',size=0;
    while(size<8192) {const {done,value}=await reader.read(); if(done)break; size+=value.length; text+=new TextDecoder().decode(value);}
    await reader.cancel();
    console.log(JSON.stringify({label,status:response.status,challenge:response.headers.get('cf-mitigated')==='challenge'||/just a moment|challenge-platform|cf-chl-/i.test(text),healthy:text.trim()==='{"status":"ok"}',cloudflare:response.headers.get('server')==='cloudflare',html:response.headers.get('content-type')?.includes('text/html')??false,proxyDenied:/ROBOTS_DENIED|blocked by proxy|egress/i.test(text)}));
  } catch {console.log(JSON.stringify({label,code:'NETWORK_FAILED'}));}
}
