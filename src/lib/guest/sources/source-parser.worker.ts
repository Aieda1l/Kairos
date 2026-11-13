import {guestApiErrorCodeSchema} from '../errors';
import {parseGuestSourceBytes} from './parse';
import type {GuestSourceParseInput} from './wire';

self.onmessage=async (event:MessageEvent<{id:string;input:GuestSourceParseInput}>)=>{
 const {id,input}=event.data;
 try{const result=await parseGuestSourceBytes(input);self.postMessage({id,ok:true,result});}
 catch(error){const code=guestApiErrorCodeSchema.safeParse((error as {code?:unknown})?.code);self.postMessage({id,ok:false,code:code.success?code.data:'SERVICE_UNAVAILABLE'});}
};
