import { render,screen,fireEvent } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import type { Event } from '@eventer/shared';
import { AddToCalendarButton } from './AddToCalendarButton.js';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
const event=(visibility:Event['visibility'])=>({id:'event',slug:'share',title:'Private title',status:'published',visibility,startsAt:Date.now()+60000,endsAt:Date.now()+3600000,scheduling:false,venueType:'online',venueOnline:'https://meet.example.com'} as Event);
afterEach(()=>vi.restoreAllMocks());
it('public calendar preserves ordinary link without confirmation',()=>{
 const confirm=vi.spyOn(window,'confirm');render(<AddToCalendarButton event={event('public')}/>);
 expect(screen.getByRole('link').getAttribute('href')).toContain('calendar.google.com');expect(confirm).not.toHaveBeenCalled();
});
it.each(['private','unlisted'] as const)('%s has no external href before explicit confirmation',visibility=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true),open=vi.spyOn(window,'open').mockReturnValue(null);
 render(<AddToCalendarButton event={event(visibility)}/>);expect(screen.queryByRole('link')).toBeNull();
 const button=screen.getByRole('button');expect(button.getAttribute('href')).toBeNull();fireEvent.click(button);expect(open).not.toHaveBeenCalled();
 fireEvent.click(button);expect(confirm).toHaveBeenCalledTimes(2);expect(open).toHaveBeenCalledWith(expect.stringContaining('calendar.google.com'),'_blank','noopener,noreferrer');
});
