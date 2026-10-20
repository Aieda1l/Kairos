for (const [label, agent, cache] of [['identified-cached','Kairos-Health/1.0 (+https://mykairos.me)',false],['identified-exact','Kairos-Health/1.0 (+https://mykairos.me)',true],['compatible-exact','Mozilla/5.0 (compatible; Kairos-Health/1.0; +https://mykairos.me)',true],['default-cached',null,false]]) {
  try {
    const response=await fetch('https://mykairos.me/api/health',{redirect:'error',...(cache?{cache:'no-store'}:{}),signal:AbortSignal.timeout(10000),headers:{accept:'application/json',...(agent?{'user-agent':agent}:{})}});
    const reader=response.body.getReader();let text='',size=0;
    while(size<8192){const {done,value}=await reader.read();if(done)break;size+=value.length;text+=new TextDecoder().decode(value);}await reader.cancel();
    console.log(JSON.stringify({label,status:response.status,challenge:response.headers.get('cf-mitigated')==='challenge'||/just a moment|challenge-platform|cf-chl-/i.test(text),healthy:text.trim()==='{"status":"ok"}',cloudflare:response.headers.get('server')==='cloudflare',ray:response.headers.get('cf-ray')}));
  }catch{console.log(JSON.stringify({label,code:'NETWORK_FAILED'}));}
}
