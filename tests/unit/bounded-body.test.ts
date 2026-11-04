import {describe,expect,it} from "vitest";
import {BoundedBodyError,readBoundedJson,readBoundedUtf8} from "@/lib/http/bounded-body";
import {bytesStream} from "../helpers/guest-source-fixtures";

const signal=new AbortController().signal;
describe("bounded upstream body readers",()=>{
  it("accepts the exact byte limit and rejects the next actual streamed byte",async()=>{
    expect(await readBoundedUtf8(bytesStream([new Uint8Array([97,98,99,100])]),{maxBytes:4,signal})).toBe("abcd");
    await expect(readBoundedUtf8(bytesStream([new Uint8Array([97,98]),new Uint8Array([99,100,101])]),{maxBytes:4,signal})).rejects.toMatchObject({code:"BODY_TOO_LARGE"});
  });
  it("decodes split multibyte UTF-8 without replacing invalid data",async()=>{
    expect(await readBoundedUtf8(bytesStream([new Uint8Array([0xe2]),new Uint8Array([0x82,0xac])]),{maxBytes:3,signal})).toBe("€");
    for(const bytes of [[0xff],[0xe2,0x82]]){
      await expect(readBoundedUtf8(bytesStream([new Uint8Array(bytes)]),{maxBytes:4,signal})).rejects.toMatchObject({code:"INVALID_UTF8"});
    }
  });
  it("parses JSON and rejects malformed JSON with a fixed error",async()=>{
    expect(await readBoundedJson(bytesStream([new TextEncoder().encode('{"a":1}')]),{maxBytes:7,signal})).toEqual({a:1});
    await expect(readBoundedJson(bytesStream([new TextEncoder().encode("private invalid json")]),{maxBytes:100,signal})).rejects.toBeInstanceOf(BoundedBodyError);
    await expect(readBoundedJson(bytesStream([]),{maxBytes:4,signal})).rejects.toMatchObject({code:"INVALID_JSON"});
  });
  it("aborts a stalled read even when cancellation never settles",async()=>{
    const controller=new AbortController();let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>{}),cancel(){cancelled=true;return new Promise(()=>{});}});
    const reading=readBoundedUtf8(stream,{maxBytes:4,signal:controller.signal});
    controller.abort();
    await expect(reading).rejects.toMatchObject({code:"BODY_ABORTED"});
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
  it("does not await cancellation when exceeding the limit",async()=>{
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(5));},cancel:()=>new Promise(()=>{})});
    await expect(readBoundedUtf8(stream,{maxBytes:4,signal})).rejects.toMatchObject({code:"BODY_TOO_LARGE"});
    expect(stream.locked).toBe(false);
  });
});
