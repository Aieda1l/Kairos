// @vitest-environment jsdom
import {act} from 'react';
import {renderToString} from 'react-dom/server';
import {hydrateRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {TimezoneControl} from '@/features/settings/timezone-control';
it('hydrates without mismatches when the browser and workerd have different IANA enumeration data',async()=>{
  const enumeration=vi.spyOn(Intl,'supportedValuesOf').mockReturnValue(['Europe/London']);
  const element=<TimezoneControl value="Asia/Kathmandu" onChange={()=>{}}/>;
  const container=document.createElement('div');container.innerHTML=renderToString(element);document.body.append(container);
  enumeration.mockReturnValue(['Pacific/Guadalcanal','Pacific/Auckland']);
  const errors:unknown[]=[];let root!:ReturnType<typeof hydrateRoot>;
  try{
    await act(async()=>{root=hydrateRoot(container,element,{onRecoverableError:e=>errors.push(e)});});
    expect(errors).toEqual([]);
    expect(container.querySelector('input')).toHaveValue('Asia/Kathmandu');
  }finally{await act(async()=>root.unmount());container.remove();enumeration.mockRestore();}
});
