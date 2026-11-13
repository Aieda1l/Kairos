import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {parseCanvasIcal} from '@/lib/sources/canvas-ical/parser';
afterEach(()=>vi.restoreAllMocks());
it('keeps valid siblings when a server fallback hash cannot be computed',()=>{
  vi.spyOn(crypto,'createHash').mockImplementation(()=>{throw new Error('synthetic private hash error');});
  const source='BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Fallback\nURL:https://canvas.uw.edu/calendar?include_contexts=course_12#assignment_1\nEND:VEVENT\nBEGIN:VEVENT\nUID:event-assignment-2\nSUMMARY:Survivor\nEND:VEVENT\nEND:VCALENDAR';
  const result=parseCanvasIcal(source);
  expect(result.assignments.map(x=>x.externalId)).toEqual(['event-assignment-2']);
  expect(result.skipped).toBe(1);expect(result.errors).toEqual(['Skipped one malformed Canvas assignment event.']);
});
