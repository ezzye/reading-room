import {env} from 'cloudflare:workers';
import {discussionAPI} from '../../../lib/discussion-service';
import {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>discussionAPI(r,env as unknown as Config);
export const POST=GET;
