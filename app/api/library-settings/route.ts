import {env} from 'cloudflare:workers';
import {librarySettingsAPI} from '../../../lib/library-server';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>librarySettingsAPI(r,env as unknown as Config);
export const POST=GET;
