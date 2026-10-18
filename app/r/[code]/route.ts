import { env } from 'cloudflare:workers';
import { resolveRoomLink } from '../../../lib/short-links';
import type { MemberAuthEnv } from '../../../lib/member-auth';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => resolveRoomLink(request, env as unknown as MemberAuthEnv);
export const HEAD = GET;
