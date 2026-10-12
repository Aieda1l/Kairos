import "server-only";

export class AuthChallengeError extends Error{
  constructor(readonly code:"AUTH_CHALLENGE_FAILED"|"AUTH_CHALLENGE_UNAVAILABLE"){
    super(code==="AUTH_CHALLENGE_FAILED"?"Complete the verification and try again.":"Verification is temporarily unavailable. Try again later.");
  }
}

export async function verifyTurnstile(
  input:{token:string;expectedAction:string;expectedHostname:string},
  deps:{secret:string;fetchImpl:typeof fetch},
):Promise<void>{
  if(typeof input.token!=="string"||!input.token.trim()||input.token.length>2048)throw new AuthChallengeError("AUTH_CHALLENGE_FAILED");
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new AuthChallengeError("AUTH_CHALLENGE_UNAVAILABLE"));},5000);
  });
  try{
    await Promise.race([timeout,(async()=>{
      const response=await deps.fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
        method:"POST",redirect:"error",cache:"no-store",signal:controller.signal,
        body:new URLSearchParams({secret:deps.secret,response:input.token}),
      });
      if(!response.ok)throw new AuthChallengeError("AUTH_CHALLENGE_UNAVAILABLE");
      // Bound the response as well as the fetch. Never retain or log provider bodies.
      const reader=response.body?.getReader();
      if(!reader)throw new AuthChallengeError("AUTH_CHALLENGE_UNAVAILABLE");
      let bytes=0,text="";const decoder=new TextDecoder();
      try{
        while(true){
          const chunk=await reader.read();if(chunk.done)break;
          bytes+=chunk.value.byteLength;
          if(bytes>8192)throw new AuthChallengeError("AUTH_CHALLENGE_UNAVAILABLE");
          text+=decoder.decode(chunk.value,{stream:true});
        }
        text+=decoder.decode();
      }finally{void reader.cancel().catch(()=>{});}
      const result:unknown=JSON.parse(text);
      if(!result||typeof result!=="object"||Array.isArray(result)
        ||(result as Record<string,unknown>).success!==true
        ||(result as Record<string,unknown>).hostname!==input.expectedHostname
        ||(result as Record<string,unknown>).action!==input.expectedAction)throw new AuthChallengeError("AUTH_CHALLENGE_FAILED");
    })()]);
  }catch(error){
    controller.abort();
    throw error instanceof AuthChallengeError?error:new AuthChallengeError("AUTH_CHALLENGE_UNAVAILABLE");
  }finally{clearTimeout(timer);}
}
