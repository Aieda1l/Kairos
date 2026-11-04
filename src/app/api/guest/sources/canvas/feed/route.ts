import {createGuestSourceHandler} from '@/lib/guest/server/source-handler';

export const POST=createGuestSourceHandler('canvas-feed');
export const GET=POST;
