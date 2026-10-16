import {expect,it} from 'vitest';
import {parseGradescopeStatus} from '@/lib/gradescope/status';
it.each(['Submitted25 Minutes Late','Submitted1 Day, 4 Hours Late','Submitted 2 Days, 1 Hour, 3 Minutes Late'])('recognizes only an explicit late-submission label: %s',text=>{
  expect(parseGradescopeStatus(text)).toMatchObject({state:'submitted',isLate:true,gradeScore:null,gradeMax:null});
});
it('preserves numeric grades with a separated late label',()=>{
  expect(parseGradescopeStatus('2.0 / 10.0 5 Hours, 31 Minutes Late')).toEqual({state:'graded',isLate:true,gradeScore:'2.0',gradeMax:'10.0',gradeDisplay:'2.0 / 10.0'});
});
it('does not invent a decimal maximum from joined grade and duration text',()=>{
  expect(parseGradescopeStatus('2.0 / 10.05 Hours, 31 Minutes Late')).toEqual({state:'graded',isLate:true,gradeScore:null,gradeMax:null,gradeDisplay:null});
});
it.each([null,'Processing','Excellent work','Submitted for grading','Submitted late','Not Submitted25 Minutes Late','2 / 10 Unpublished','x'.repeat(2049)])('retains unknown state for unsupported text %s',text=>{
  expect(parseGradescopeStatus(text).state).toBe('unknown');
});
it.each([['Submitted','submitted'],['No Submission','not_submitted'],['Not Submitted','not_submitted'],['8.50 / 10','graded']] as const)('retains plain status %s', (text,state)=>{
  expect(parseGradescopeStatus(text)).toMatchObject({state,isLate:false});
});
