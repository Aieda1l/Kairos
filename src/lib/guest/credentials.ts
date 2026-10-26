import type {GuestStore} from "./types";
export interface GuestCredentials {
  get(connectionId:string,generation:number):Promise<string|null>;
  put(connectionId:string,generation:number,value:string):void;
  forget(connectionId:string):void;
  clear():void;
}
export function createGuestCredentials(store:Pick<GuestStore,"read"|"readRememberedSecret">):GuestCredentials {
  const values=new Map<string,{generation:number;value:string}>();
  let epoch=0;
  const current=async(id:string,generation:number)=>(await store.read()).connections.some(c=>c.id===id&&c.generation===generation);
  return {
    async get(id,generation){
      const started=epoch;
      if(!await current(id,generation)){if(values.get(id)?.generation===generation)values.delete(id);return null;}
      if(started!==epoch)return null;
      const memory=values.get(id);
      if(memory?.generation===generation)return memory.value;
      const remembered=await store.readRememberedSecret(id);
      return await current(id,generation)&&started===epoch?remembered:null;
    },
    put(id,generation,value){epoch++;values.set(id,{generation,value});},
    forget(id){epoch++;values.delete(id);},
    clear(){epoch++;values.clear();},
  };
}
