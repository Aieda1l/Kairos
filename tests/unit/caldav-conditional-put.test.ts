import {describe,expect,it} from 'vitest';
import {conditionalCaldavPut} from '@/lib/calendar/caldav/conditional-put';
const url='https://p12-caldav.icloud.com/synthetic/'+'a'.repeat(64)+'.ics';
describe('conditional CalDAV PUT eligibility',()=>{
 it('requires a pinned resource and exactly one strong write precondition',()=>{
  expect(conditionalCaldavPut(url,{method:'PUT',headers:{'if-none-match':'*'},body:'body'})?.condition).toBe('absent');
  expect(conditionalCaldavPut(url,{method:'PUT',headers:{'if-match':'"etag"'},body:'body'})?.condition).toBe('"etag"');
 });
 it.each([
  [url,{method:'PUT',body:'body'}],
  [url,{method:'PUT',headers:{'if-match':'W/"weak"'},body:'body'}],
  [url,{method:'PUT',headers:{'if-match':'*'},body:'body'}],
  [url,{method:'PUT',headers:{'if-none-match':'*','if-match':'"etag"'},body:'body'}],
  [url,{method:'DELETE',headers:{'if-none-match':'*'},body:'body'}],
  [url+'?query=1',{method:'PUT',headers:{'if-none-match':'*'},body:'body'}],
  [url.replace('p12-caldav.icloud.com','untrusted.invalid'),{method:'PUT',headers:{'if-none-match':'*'},body:'body'}],
  [url.replace('https:','http:'),{method:'PUT',headers:{'if-none-match':'*'},body:'body'}],
  [url.replace('/'+'a'.repeat(64)+'.ics','/non-kairos.ics'),{method:'PUT',headers:{'if-none-match':'*'},body:'body'}],
 ] as Array<[string,RequestInit]>)('rejects unsafe conditional retry input %#',(input,init)=>{
  expect(conditionalCaldavPut(input,init)).toBeNull();
 });
});
