const unavailable=()=>new Error('Maintenance unavailable.');
/** Operator-only adapter. No retries: a lost write response has an uncertain outcome. */
export function createD1MaintenanceClient(env,options={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID,database=env.CLOUDFLARE_D1_DATABASE_ID,token=env.CLOUDFLARE_API_TOKEN;
  const timeoutMs=options.timeoutMs??15000,maxBytes=options.maxResponseBytes??8*1024*1024;
  if(typeof account!=='string'||!/^[0-9a-f]{32}$/i.test(account)||typeof database!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(database)||
    typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>8*1024*1024)throw unavailable();
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  const request=options.fetch??fetch;
  async function query(body,count){
    const controller=new AbortController();let timer;
    try{
      const pending=(async()=>{
        const response=await request(endpoint,{method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
        if(!response.ok||response.redirected||!response.body)throw unavailable();
        const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw unavailable();
        const reader=response.body.getReader(),chunks=[];let size=0;
        try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>maxBytes)throw unavailable();chunks.push(item.value);}}
        finally{void reader.cancel().catch(()=>{});}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(data?.success!==true||!Array.isArray(data.result)||data.result.length!==count)throw unavailable();
        return data.result.map(row=>{
          if(row?.success!==true||!Array.isArray(row.results)||!row.meta||typeof row.meta!=='object'||
            (row.meta.changes!==undefined&&(!Number.isSafeInteger(row.meta.changes)||row.meta.changes<0)))throw unavailable();
          return {success:true,results:row.results,meta:row.meta};
        });
      })();
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},timeoutMs);});
      return await Promise.race([pending,deadline]);
    }catch{throw unavailable();}finally{clearTimeout(timer);controller.abort();}
  }
  class Statement{
    constructor(sql,params=[]){if(typeof sql!=='string'||!sql.trim()||sql.length>32768)throw unavailable();this.sql=sql;this.params=params;}
    bind(...values){if(values.length>100||values.some(value=>typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value))))throw unavailable();return new Statement(this.sql,values.map(String));}
    async all(){return (await query({sql:this.sql,params:this.params},1))[0];}
    async first(){return (await this.all()).results[0]??null;}
    async run(){const result=await this.all();if(!Number.isSafeInteger(result.meta.changes))throw unavailable();return result;}
  }
  return {prepare:sql=>new Statement(sql),
    async batch(statements){if(!Array.isArray(statements)||!statements.length||statements.length>100||statements.some(s=>!(s instanceof Statement)))throw unavailable();return query({batch:statements.map(s=>({sql:s.sql,params:s.params}))},statements.length);},
    async exec(sql){await query({sql,params:[]},1);},
  };
}
