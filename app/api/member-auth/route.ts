import {env} from 'cloudflare:workers';
import {memberAuthAPI} from '../../../lib/member-auth';
import type {MemberAuthEnv} from '../../../lib/member-auth';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>memberAuthAPI(r,env as unknown as MemberAuthEnv);
export const POST=GET;
