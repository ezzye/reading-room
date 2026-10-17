import type { MemberAuthEnv } from './member-auth';

export const DEFAULT_ROOM_ID = '00000000-0000-4000-8000-000000000001';
export const ROOM_COOKIE = '__Host-rr_room';
export type ActiveRoom = { id: string; name: string; owner_id: string; created_at: string; moderation: string; role: 'owner'|'member'; member_id: string };
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
export function roomId(request: Request): string|null { const id=request.headers.get('x-rr-room-id'); return id&&ID_RE.test(id)?id:null; }
export function roomMemberId(request: Request): string|null { const id=request.headers.get('x-ret-member-id'); return id&&ID_RE.test(id)?id:null; }
export function isRoomOwner(request: Request): boolean { return !!roomId(request)&&!!roomMemberId(request)&&request.headers.get('x-ret-member-role')==='owner'; }
export function roomCookie(id: string): string { return `${ROOM_COOKIE}=${id}; Path=/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax`; }
export function clearRoomCookie(): string { return `${ROOM_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`; }
function selectedId(request: Request): string|null {
  // An explicit article room is checked just like a cookie. A stale selection must never fall
  // through to another room and accidentally display an identically named page.
  const url=new URL(request.url);
  if(url.searchParams.has('room')) return url.searchParams.get('room')||'';
  for(const part of (request.headers.get('cookie')||'').split(';')) {
    const index=part.indexOf('=');
    if(index>=0&&part.slice(0,index).trim()===ROOM_COOKIE) return part.slice(index+1).trim();
  }
  return null;
}
export async function memberRoom(request: Request, env: MemberAuthEnv, memberId: string): Promise<ActiveRoom|null> {
  const selection=selectedId(request);
  if(selection!==null&&!ID_RE.test(selection)) return null;
  const select=`SELECT r.*,rm.role,rm.member_id FROM rr_rooms r JOIN rr_room_members rm ON rm.room_id=r.id
    JOIN rr_members m ON m.id=rm.member_id WHERE rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`;
  if(selection!==null) return env.DB.prepare(select+' AND r.id=?').bind(memberId,selection).first<ActiveRoom>();
  // Existing sessions do not have a room cookie. Prefer the migrated room, otherwise the first
  // active membership. This fallback applies only when no room selection was supplied.
  return env.DB.prepare(select+' ORDER BY CASE WHEN r.id=? THEN 0 ELSE 1 END,r.created_at,r.id LIMIT 1').bind(memberId,DEFAULT_ROOM_ID).first<ActiveRoom>();
}
export async function requireRoom(request: Request, env: MemberAuthEnv): Promise<ActiveRoom> {
  const id=roomId(request), member=roomMemberId(request);
  if(!id||!member) throw Response.json({error:'Sign in and select a room.'},{status:401});
  const room=await env.DB.prepare(`SELECT r.*,rm.role,rm.member_id FROM rr_rooms r JOIN rr_room_members rm ON rm.room_id=r.id
    JOIN rr_members m ON m.id=rm.member_id WHERE r.id=? AND rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`)
    .bind(id,member).first<ActiveRoom>();
  if(!room) throw Response.json({error:'You do not have access to this room.'},{status:403});
  return room;
}
export async function accessiblePage(request: Request, env: MemberAuthEnv, pageId: string): Promise<boolean> {
  const room=await requireRoom(request,env);
  return !!await env.DB.prepare('SELECT 1 AS found FROM rr_room_articles WHERE room_id=? AND page_id=?').bind(room.id,pageId).first();
}

// Schema is migrated before release. D1 batch is transactional: competing first requests
// recheck the marker inside that transaction, so none can copy a newly-created room's data.
export async function ensureRooms(env: MemberAuthEnv): Promise<void> {
  if(await env.DB.prepare("SELECT id FROM rr_room_migrations WHERE id='legacy-room-v1'").first())return;
  if(!env.DB.batch)throw Error('Transactional room migration requires D1 batch.');
  const pending="NOT EXISTS (SELECT 1 FROM rr_room_migrations WHERE id='legacy-room-v1')";
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO rr_rooms(id,name,owner_id,created_at,moderation)
      SELECT ?,'Reading Room',id,created_at,'open' FROM rr_members WHERE role='owner' AND ${pending} ORDER BY created_at LIMIT 1`).bind(DEFAULT_ROOM_ID),
    env.DB.prepare(`INSERT OR IGNORE INTO rr_room_members(room_id,member_id,role,joined_at,revoked_at)
      SELECT ?,id,role,created_at,revoked_at FROM rr_members WHERE ${pending} AND EXISTS(SELECT 1 FROM rr_rooms WHERE id=?)`).bind(DEFAULT_ROOM_ID,DEFAULT_ROOM_ID),
    env.DB.prepare(`INSERT OR IGNORE INTO rr_room_articles(room_id,page_id,added_by,created_at)
      SELECT ?,p.id,r.owner_id,p.created_at FROM education_pages p JOIN rr_rooms r ON r.id=? WHERE ${pending}`).bind(DEFAULT_ROOM_ID,DEFAULT_ROOM_ID),
    env.DB.prepare(`UPDATE rr_invites SET room_id=? WHERE room_id IS NULL AND ${pending} AND EXISTS(SELECT 1 FROM rr_rooms WHERE id=?)`).bind(DEFAULT_ROOM_ID,DEFAULT_ROOM_ID),
    env.DB.prepare(`INSERT OR IGNORE INTO rr_room_migrations(id) SELECT 'legacy-room-v1' WHERE ${pending} AND EXISTS(SELECT 1 FROM rr_rooms WHERE id=?)`).bind(DEFAULT_ROOM_ID)
  ]);
}
