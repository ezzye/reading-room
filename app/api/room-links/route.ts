import { env } from 'cloudflare:workers';
import { roomLinksAPI } from '../../../lib/short-links';
import type { MemberAuthEnv } from '../../../lib/member-auth';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => roomLinksAPI(request, env as unknown as MemberAuthEnv);
