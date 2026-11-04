import {createGuestSessionHandlers} from '@/lib/guest/server/session';

export const POST=createGuestSessionHandlers().end;
