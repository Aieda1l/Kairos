import {afterEach,beforeEach,expect,it,vi} from "vitest";
beforeEach(()=>vi.resetModules());
afterEach(()=>vi.restoreAllMocks());

it("accepts IANA zones and rejects invalid zones",async()=>{
  const {validateTimeZone}=await import("@/lib/dates/validate-timezone");
  expect(validateTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
  expect(()=>validateTimeZone("Pacific-ish")).toThrowError(/INVALID_TIMEZONE/);
});

it('avoids repeated native formatter construction for the same trimmed zone',async()=>{
  const {validateTimeZone}=await import("@/lib/dates/validate-timezone");
  const constructor=vi.spyOn(Intl,'DateTimeFormat');
  for(const input of ['  America/Los_Angeles  ','America/Los_Angeles','America/Los_Angeles ']){
    expect(validateTimeZone(input)).toBe('America/Los_Angeles');
  }
  expect(constructor).toHaveBeenCalledTimes(1);
});

it('preserves accepted aliases and repeatedly rejects invalid or empty inputs',async()=>{
  const {validateTimeZone}=await import("@/lib/dates/validate-timezone");
  for(const zone of ['UTC','Etc/GMT+8','america/new_york']){
    expect(validateTimeZone(' '+zone+' ')).toBe(zone);
    expect(validateTimeZone(zone)).toBe(zone);
  }
  for(const input of ['Pacific-ish','Pacific-ish','','   ']){
    expect(()=>validateTimeZone(input)).toThrow('INVALID_TIMEZONE: Enter a valid IANA timezone.');
  }
});

it('evicts old successful entries instead of retaining an unbounded set of user choices',async()=>{
  const {validateTimeZone}=await import("@/lib/dates/validate-timezone");
  const constructor=vi.spyOn(Intl,'DateTimeFormat');
  const zones=Intl.supportedValuesOf('timeZone').slice(0,160);
  for(const zone of zones)expect(validateTimeZone(zone)).toBe(zone);
  expect(validateTimeZone(zones[0])).toBe(zones[0]);
  expect(constructor.mock.calls.filter(([,options])=>options?.timeZone===zones[0])).toHaveLength(2);
});
