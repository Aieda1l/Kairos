// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {renderToStaticMarkup} from 'react-dom/server';
import {hydrateRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryInput} from '@/features/onboarding/private-drafts';
afterEach(cleanup);
it('keeps the server-rendered field disabled and never serializes its value',()=>{
  const html=renderToStaticMarkup(<MemoryInput value="synthetic-private-input" onValueChange={()=>{}}/>);
  const parsed=new DOMParser().parseFromString(html,'text/html');
  expect(parsed.querySelector('input')?.disabled).toBe(true);
  expect(html).not.toContain('synthetic-private-input');
  expect(parsed.querySelector('input')?.hasAttribute('value')).toBe(false);
});
it('enables after hydration and keeps edits in the live property only',async()=>{
  const onValueChange=vi.fn();
  const element=<MemoryInput aria-label="Private input" value="" onValueChange={onValueChange}/>;
  const container=document.createElement('div');container.innerHTML=renderToStaticMarkup(element);document.body.append(container);
  let root:Root|undefined;
  try{
    expect(container.querySelector('input')).toBeDisabled();
    await act(async()=>{root=hydrateRoot(container,element);});
    const input=container.querySelector('input')!;expect(input).toBeEnabled();
    fireEvent.change(input,{target:{value:'synthetic-edited-input'}});
    expect(onValueChange).toHaveBeenCalledWith('synthetic-edited-input');
    expect(input.value).toBe('synthetic-edited-input');expect(input.outerHTML).not.toContain('synthetic-edited-input');
    await act(async()=>{root!.render(<MemoryInput aria-label="Private input" value="" disabled onValueChange={onValueChange}/>);});
    expect(input).toBeDisabled();
  }finally{await act(async()=>root?.unmount());container.remove();}
});
it('respects a caller-disabled field after client mounting',()=>{
  render(<MemoryInput aria-label="Disabled private input" value="" disabled onValueChange={()=>{}}/>);
  expect(screen.getByRole('textbox')).toBeDisabled();
});
