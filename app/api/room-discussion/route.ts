import {env} from 'cloudflare:workers';
import {roomDiscussionAPI} from '../../../lib/room-discussion';
import type {MemberAuthEnv} from '../../../lib/member-auth';

export const dynamic='force-dynamic';
export const GET=(request:Request)=>roomDiscussionAPI(request,env as unknown as MemberAuthEnv);
export const POST=GET;
