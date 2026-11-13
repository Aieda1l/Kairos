import {describe,it,expect} from 'vitest';
import {encodeGuestWireBytes,readGuestReadReceiptMetadata,GUEST_SOURCE_WIRE_VERSION,guestSourceApprovalRequestSchema} from '@/lib/guest/sources/wire';
const payload={v:2,aud:'https://kairos.example',sessionTag:encodeGuestWireBytes(new Uint8Array(32)),operation:'ed-courses',requestId:'00000000-0000-4000-8000-000000000001',checkedAt:'2026-01-01T00:00:00.000Z',issuedAtMs:Date.parse('2026-01-01T00:00:00.000Z'),deadlineAtMs:Date.parse('2026-01-01T00:00:01.000Z'),providerVersion:1,courseId:null};
const make=(value:unknown)=>encodeGuestWireBytes(new TextEncoder().encode(JSON.stringify(value)))+'.'+encodeGuestWireBytes(new Uint8Array(32));
describe('guest wire',()=>{
 it('structurally decodes a canonical receipt without authenticating it',()=>{expect(GUEST_SOURCE_WIRE_VERSION).toBe(2);expect(readGuestReadReceiptMetadata(make(payload))).toEqual(payload);expect(readGuestReadReceiptMetadata(make(payload)+'=')).toBeNull();expect(readGuestReadReceiptMetadata(make({...payload,deadlineAtMs:payload.issuedAtMs+15001}))).toBeNull();expect(readGuestReadReceiptMetadata(make({...payload,courseId:'12'}))).toBeNull();expect(readGuestReadReceiptMetadata(make({...payload,extra:true}))).toBeNull();});
 it('requires the exact approval fields',()=>{expect(guestSourceApprovalRequestSchema.safeParse({schemaVersion:2,requestId:payload.requestId,receipt:make(payload)}).success).toBe(true);expect(guestSourceApprovalRequestSchema.safeParse({schemaVersion:2,requestId:payload.requestId,receipt:make(payload),token:'secret'}).success).toBe(false);});
});
