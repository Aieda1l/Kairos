import {canvasBody,edBody} from './guest-workerd-fixtures.mjs';
export const requestId="00000000-0000-4000-8000-000000000001";
export const checkedAt="2026-11-12T12:00:00.000Z";
const event=(body)=>`BEGIN:VEVENT\n${body}\nEND:VEVENT`;
const calendar=(events)=>`BEGIN:VCALENDAR\nVERSION:2.0\n${events}\nEND:VCALENDAR`;
export const cases=[
 {name:"canvas-mixed",operation:"canvas-feed",body:calendar([
 event('UID:event-assignment-1\nSUMMARY:Café 🐈 folded\n line [Course]\nDTSTART;VALUE=DATE:20261101\nDTSTAMP:20261101T120000\nURL:https://canvas.uw.edu/calendar?include_contexts=course_42#assignment_7'),
 event('SUMMARY:No UID [Course]\nDTSTART:20261102T123000\nURL:https://canvas.uw.edu/calendar?include_contexts=course_42#assignment_8'),
 event('UID:event-assignment-3\nSUMMARY:Unknown zone\nDTSTART;TZID=Unknown/Zone:20261102T123000\nURL:https://evil.example/private?secret=abc'),
 'BEGIN:VEVENT\nUID:event-assignment-broken\nBEGIN:VALARM',event('UID:event-assignment-4\nSUMMARY:Survivor\nDTSTART:20261103T123000Z'),
 event('UID:other\nSUMMARY:Ignored')].join('\n'))},
 {name:"canvas-empty",operation:"canvas-feed",body:''},
 {name:"canvas-malformed",operation:"canvas-feed",body:calendar(event('UID:event-assignment-1'))},
 {name:"canvas-duplicate",operation:"canvas-feed",body:calendar([event('UID:event-assignment-1\nSUMMARY:A'),event('UID:event-assignment-1\nSUMMARY:B')].join('\n'))},
 {name:"ed-courses",operation:"ed-courses",body:JSON.stringify({user:{},courses:[{course:{id:42,code:'CS',name:'Computer Science',session:'Autumn',year:2026}},{course:{id:43,code:'MATH',name:'Math'}}]})},
 {name:"ed-lessons",operation:"ed-lessons",courseId:"42",body:JSON.stringify({lessons:[{id:7,course_id:42,title:'Lecture',status:'completed',due_at:'2026-11-12T12:00:00.000Z'},{id:8,course_id:42,title:'Hidden',is_hidden:true},{id:9,course_id:43,title:'Other'}]})},
 {name:"ed-duplicate",operation:"ed-courses",body:JSON.stringify({user:{},courses:[{course:{id:42,name:'One'}},{course:{id:42,name:'Two'}}]})},
 {name:"ed-unsafe",operation:"ed-lessons",courseId:"42",body:'{"lessons":[{"id":9007199254740992,"title":"Unsafe"}]}'},
];
cases.push(
 {name:'canvas-cap',operation:'canvas-feed',body:canvasBody(2000,true),digestOnly:true},
 {name:'canvas-ordinary-cap',operation:'canvas-feed',body:canvasBody(5000).replaceAll('event-assignment-','event-calendar-'),digestOnly:true},
 {name:'canvas-block-over',operation:'canvas-feed',body:canvasBody(5001).replaceAll('event-assignment-','event-calendar-')},
 {name:'ed-courses-cap',operation:'ed-courses',body:edBody('courses',500,true),digestOnly:true},
 {name:'ed-lessons-cap',operation:'ed-lessons',courseId:'12',body:edBody('lessons',2000,true),digestOnly:true},
 {name:'ed-course-over',operation:'ed-courses',body:edBody('courses',501)},
 {name:'ed-raw-lessons-over',operation:'ed-lessons',courseId:'12',body:edBody('lessons',2001).replaceAll('"is_hidden":false','"is_hidden":true')},
 {name:'ed-unsafe-courses',operation:'ed-courses',body:'{"courses":[{"course":{"id":9007199254740992,"name":"Unsafe"}}]}'},
 {name:'canvas-invalid-utf8',operation:'canvas-feed',body:'',bytes:[195,40]},
 {name:'ed-invalid-utf8',operation:'ed-courses',body:'',bytes:[195,40]},
 {name:'canvas-byte-over',operation:'canvas-feed',body:'x'.repeat(2*1024*1024+1)},
 {name:'ed-escaped-output-over',operation:'ed-lessons',courseId:'42',body:JSON.stringify({lessons:Array.from({length:1000},(_,i)=>({id:i+1,title:'"'.repeat(500),status:'"'.repeat(500)}))})},
);
export function bytesForCase(item){return item.bytes?Uint8Array.from(item.bytes):new TextEncoder().encode(item.body);}
