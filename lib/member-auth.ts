import { ensureRooms, memberRoom, roomCookie, clearRoomCookie, DEFAULT_ROOM_ID, type ActiveRoom } from './rooms.ts';
export const MEMBER_SESSION_COOKIE = "__Host-rr_session";
export const MEMBER_SESSION_DAYS = 90;
export const MEMBER_INVITE_DAYS = 7;
export const MEMBER_RECOVERY_DAYS = 90;

type D1Result<T = unknown> = { results?: T[]; success?: boolean; meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
};
export type MemberAuthEnv = {
  DB: { prepare(sql: string): D1Statement; batch?(statements: D1Statement[]): Promise<unknown> };
  READER_OWNER_EMAIL?: string;
  RR_TRUST_SITES_BOOTSTRAP?: string;
};
export type RoomMember = {
  id: string;
  display_name: string;
  role: "owner" | "member";
  created_at: string;
  revoked_at: string | null;
};
type SessionMember = RoomMember & { session_expires_at: string; device_label: string };

const OAI_HEADERS = [
  "oai-authenticated-user-id",
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
];
const TOKEN_RE = /^[a-f0-9]{64}$/;
const MEMBER_ROOM_ORIGIN = "https://reading-room.invalid";

const json = (body: unknown, status=200, headers?: HeadersInit) => {
  const out=new Headers(headers);out.set('Cache-Control','no-store');
  return Response.json(body,{status,headers:out});
};
function withAuthCookies(body:unknown,token:string,room:string,status=201):Response {
  const headers=new Headers({'Set-Cookie':setSessionCookie(token)});headers.append('Set-Cookie',roomCookie(room));
  return json(body,status,headers);
}
function publicRoom(room:ActiveRoom){return {id:room.id,name:room.name,role:room.role,moderation:room.moderation};}
const denied = (status: number, error: string) => json({ error }, status);
const nowIso = (now = Date.now()) => new Date(now).toISOString();
const plusDays = (days: number, now = Date.now()) => new Date(now + days * 86_400_000).toISOString();
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie") ?? "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_RE.test(value) ? value : null;
  }
  return null;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function sameOriginWrite(request: Request): Response | null {
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") return denied(403, "Same-origin request required.");
  return null;
}

export function safeMemberNextPath(value: string | null | undefined): string {
  if (!value || value.length > 1024 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("#")) return "/capture";
  try {
    if (decodeURIComponent(value).includes("\\")) return "/capture";
    const url = new URL(value, MEMBER_ROOM_ORIGIN);
    if (url.origin !== MEMBER_ROOM_ORIGIN || url.hash || url.pathname === "/room" || url.pathname === "/api/member-auth") return "/capture";
    return `${url.pathname}${url.search}`;
  } catch { return "/capture"; }
}

export async function sessionMember(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<SessionMember | null> {
  const raw = cookieValue(request, MEMBER_SESSION_COOKIE);
  if (!raw) return null;
  const hash = await tokenHash(raw);
  return env.DB.prepare(`SELECT m.id, m.display_name, m.role, m.created_at, m.revoked_at, s.expires_at AS session_expires_at, s.device_label
    FROM rr_sessions s JOIN rr_members m ON m.id=s.member_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND m.revoked_at IS NULL AND s.expires_at>?`)
    .bind(hash, nowIso(now)).first<SessionMember>();
}

async function isFirstOwner(env: MemberAuthEnv): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS found FROM rr_members WHERE role='owner' LIMIT 1").first<{ found: number }>();
  return !row;
}

async function bootstrapOwner(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<RoomMember | null> {
  const ownerEmail = env.READER_OWNER_EMAIL?.trim().toLowerCase();
  const supplied = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (env.RR_TRUST_SITES_BOOTSTRAP !== "1" || !ownerEmail || supplied !== ownerEmail || !(await isFirstOwner(env))) return null;
  const member: RoomMember = { id: crypto.randomUUID(), display_name: "Owner", role: "owner", created_at: nowIso(now), revoked_at: null };
  try {
    await env.DB.prepare("INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)")
      .bind(member.id, member.display_name, member.role, member.created_at).run();
    return member;
  } catch {
    // Concurrent first visits or an already-applied bootstrap must not create a second owner.
    return null;
  }
}

async function createSession(env: MemberAuthEnv, memberId: string, now = Date.now(), deviceLabel = "This device"): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expiresAt = plusDays(MEMBER_SESSION_DAYS, now);
  await env.DB.prepare("INSERT INTO rr_sessions(token_hash,member_id,device_label,created_at,expires_at) VALUES(?,?,?,?,?)")
    .bind(await tokenHash(token), memberId, deviceLabel.trim().slice(0, 48) || "This device", nowIso(now), expiresAt).run();
  return { token, expiresAt };
}

function setSessionCookie(token: string): string {
  return `${MEMBER_SESSION_COOKIE}=${token}; Path=/; Max-Age=${MEMBER_SESSION_DAYS * 86400}; Secure; HttpOnly; SameSite=Lax`;
}
function clearSessionCookie(): string {
  return `${MEMBER_SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
function publicMember(member: RoomMember | SessionMember) {
  return { id: member.id, displayName: member.display_name, role: member.role, createdAt: member.created_at };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 4096) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    try { await reader.cancel(); } catch { /* stream may already be closed */ }
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function purgeExpiredOwnerArtifacts(env: MemberAuthEnv, now: number): Promise<void> {
  const stamp = nowIso(now);
  // Keep article invitation receipts until the UTC day ends, including consumed links,
  // so accepting a link cannot reset the daily sharing allowance.
  await env.DB.prepare("DELETE FROM rr_invites WHERE (used_at IS NOT NULL OR expires_at<=?) AND (article_id IS NULL OR created_at<?)").bind(stamp,stamp.slice(0,10)+'T00:00:00.000Z').run();
  await env.DB.prepare("DELETE FROM rr_recovery_codes WHERE used_at IS NOT NULL OR expires_at<=?").bind(stamp).run();
}

async function requireOwner(request: Request, env: MemberAuthEnv, now=Date.now()): Promise<{ member: SessionMember|null; room: ActiveRoom|null; response: Response|null }> {
  const identity = await sessionMember(request, env, now);
  if (!identity) return { member:null,room:null,response:denied(401,"Sign in to manage this room.") };
  const room=await memberRoom(request,env,identity.id);
  if (!room||room.role!=='owner') return {member:null,room:null,response:denied(403,"Owner access to this room is required.")};
  return {member:{...identity,role:room.role},room,response:null};
}

/** Public member-auth API. Identities are global; all room authority comes from membership. */
export async function memberAuthAPI(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "session";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", Allow: "GET, POST, OPTIONS" } });
  if (request.method !== (action === "session" || action === "admin" ? "GET" : "POST")) return denied(405, "Method not allowed.");
  if (request.method === "POST") {
    const csrf = sameOriginWrite(request);
    if (csrf) return csrf;
  }

  try {
    await ensureRooms(env);
    if (action === "session") {
      const member = await sessionMember(request, env, now);
      if (!member) return denied(401, "This room is private. Use an invitation link or the owner's first sign-in.");
      const room=await memberRoom(request,env,member.id);
      return json({ member: publicMember({...member,role:room?.role??'member'}), activeRoom:room?publicRoom(room):null, expiresAt: member.session_expires_at });
    }

    if (action === "bootstrap") {
      // Trust platform identity only for the explicit, first-owner bootstrap. After any owner
      // row exists, OAI headers never authenticate or upgrade a request.
      const owner = await bootstrapOwner(request, env, now);
      if (!owner) return denied(401, "Owner bootstrap is unavailable for this request.");
      await ensureRooms(env);
      const session = await createSession(env, owner.id, now, "Owner's first device");
      return withAuthCookies({ member: publicMember(owner), expiresAt: session.expiresAt, nextPath:'/capture' },session.token,DEFAULT_ROOM_ID);
    }

    if (action === "accept") {
      const body = await readJson(request);
      if (!body) return denied(400, "Invalid request.");
      const token = typeof body.token === 'string' ? body.token.toLowerCase() : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0,48) : '';
      const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim().slice(0,48) : '';
      if (!TOKEN_RE.test(token)) return denied(400, 'A valid invitation is required.');
      const inviteHash=await tokenHash(token);
      type Invite={member_id:string;created_by:string;purpose:string;room_id:string;article_id:string|null};
      const pending=await env.DB.prepare(`SELECT member_id,created_by,purpose,room_id,article_id FROM rr_invites
        WHERE token_hash=? AND used_at IS NULL AND expires_at>?`).bind(inviteHash,nowIso(now)).first<Invite>();
      if(!pending) return denied(410,'This invitation has expired or has already been used.');
      const invitingOwner=await env.DB.prepare(`SELECT r.id FROM rr_rooms r JOIN rr_room_members rm ON rm.room_id=r.id JOIN rr_members m ON m.id=rm.member_id
        WHERE r.id=? AND rm.member_id=? AND rm.role='owner' AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`).bind(pending.room_id,pending.created_by).first();
      if(!invitingOwner) return denied(410,'This room invitation is no longer valid.');
      if(pending.article_id&&!await env.DB.prepare('SELECT 1 AS found FROM rr_room_articles WHERE room_id=? AND page_id=?').bind(pending.room_id,pending.article_id).first())return denied(410,'This article invitation is no longer valid.');
      const signedIn=await sessionMember(request,env,now);
      if((pending.purpose==='device'&&!deviceLabel)||(pending.purpose==='member'&&!signedIn&&!displayName))return denied(400,pending.purpose==='device'?'A name for this device is required.':'A display name is required.');
      let member: RoomMember;
      if(pending.purpose==='device') {
        const existing=await env.DB.prepare(`SELECT m.id,m.display_name,rm.role,m.created_at,m.revoked_at FROM rr_members m
          JOIN rr_room_members rm ON rm.member_id=m.id WHERE m.id=? AND rm.room_id=? AND rm.role='owner' AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`)
          .bind(pending.member_id,pending.room_id).first<RoomMember>();
        if(!existing)return denied(410,'This owner-device invitation is no longer valid.');
        member=existing;
      } else member=signedIn?{...signedIn,role:'member'}:{id:pending.member_id,display_name:displayName,role:'member',created_at:nowIso(now),revoked_at:null};
      // Only a successful atomic consume may create membership or a session. Existing signed-in
      // people retain their identity; the invitation's provisional member id is never duplicated.
      const consumed=await env.DB.prepare(`UPDATE rr_invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING token_hash`)
        .bind(nowIso(now),inviteHash,nowIso(now)).first();
      if(!consumed)return denied(410,'This invitation has expired or has already been used.');
      if(pending.purpose==='member') {
        if(!signedIn)await env.DB.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').bind(member.id,member.display_name,'member',member.created_at).run();
        await env.DB.prepare(`INSERT INTO rr_room_members(room_id,member_id,role,joined_at,revoked_at) VALUES(?,?,'member',?,NULL)
          ON CONFLICT(room_id,member_id) DO UPDATE SET revoked_at=NULL`).bind(pending.room_id,member.id,nowIso(now)).run();
        const membership=await env.DB.prepare('SELECT role FROM rr_room_members WHERE room_id=? AND member_id=?').bind(pending.room_id,member.id).first<{role:'owner'|'member'}>();
        member.role=membership?.role??'member';
      }
      const session=await createSession(env,member.id,now,deviceLabel||'This device');
      const nextPath=pending.article_id?`/read/${encodeURIComponent(pending.article_id)}?room=${encodeURIComponent(pending.room_id)}`:'/capture';
      return withAuthCookies({member:publicMember(member),expiresAt:session.expiresAt,nextPath},session.token,pending.room_id);
    }

    if (action === "recover") {
      const body = await readJson(request);
      if (!body) return denied(400, "Invalid request.");
      const token = typeof body.token === "string" ? body.token.toLowerCase() : "";
      const deviceLabel = typeof body.deviceLabel === "string" ? body.deviceLabel.trim().slice(0, 48) : "";
      if (!TOKEN_RE.test(token) || !deviceLabel) return denied(400, "A valid recovery link and device name are required.");
      const member = await env.DB.prepare(`UPDATE rr_recovery_codes SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?
        AND member_id IN (SELECT m.id FROM rr_members m JOIN rr_room_members rm ON rm.member_id=m.id WHERE rm.role='owner' AND rm.revoked_at IS NULL AND m.revoked_at IS NULL) RETURNING member_id`)
        .bind(nowIso(now), await tokenHash(token), nowIso(now)).first<{ member_id: string }>();
      if (!member) return denied(410, "This recovery link has expired or has already been used.");
      await env.DB.prepare("UPDATE rr_sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL")
        .bind(nowIso(now), member.member_id).run();
      await env.DB.prepare("DELETE FROM rr_invites WHERE member_id=? AND purpose='device' AND used_at IS NULL")
        .bind(member.member_id).run();
      const session = await createSession(env, member.member_id, now, deviceLabel);
      const owner = await env.DB.prepare("SELECT id,display_name,role,created_at,revoked_at FROM rr_members WHERE id=? AND revoked_at IS NULL")
        .bind(member.member_id).first<RoomMember>();
      if (!owner) return denied(410, "This recovery link is no longer valid.");
      const owned=await env.DB.prepare(`SELECT r.*,rm.role,rm.member_id FROM rr_rooms r JOIN rr_room_members rm ON rm.room_id=r.id
        WHERE rm.member_id=? AND rm.role='owner' AND rm.revoked_at IS NULL ORDER BY r.created_at,r.id LIMIT 1`).bind(owner.id).first<ActiveRoom>();
      const room=owned??await memberRoom(new Request(new URL('/room',request.url)),env,owner.id);
      if(!room)return denied(410,'No active room is available for this recovery.');
      return withAuthCookies({member:publicMember({...owner,role:room.role}),expiresAt:session.expiresAt,nextPath:'/capture'},session.token,room.id);
    }

    if (action === "recovery-create") {
      const auth = await requireOwner(request, env, now);
      if (auth.response || !auth.member) return auth.response ?? denied(401, "Sign in required.");
      await purgeExpiredOwnerArtifacts(env, now);
      const token = randomToken(), createdAt = nowIso(now), expiresAt = plusDays(MEMBER_RECOVERY_DAYS, now);
      await env.DB.prepare("UPDATE rr_recovery_codes SET used_at=? WHERE member_id=? AND used_at IS NULL")
        .bind(createdAt, auth.member.id).run();
      await env.DB.prepare("INSERT INTO rr_recovery_codes(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)")
        .bind(await tokenHash(token), auth.member.id, createdAt, expiresAt).run();
      const recoveryUrl = new URL("/room", request.url);
      recoveryUrl.hash = `recover=${token}`;
      return json({ url: recoveryUrl.toString(), expiresAt }, 201);
    }

    if (action === "logout") {
      const member = await sessionMember(request, env, now);
      if (member) {
        const raw = cookieValue(request, MEMBER_SESSION_COOKIE)!;
        await env.DB.prepare("UPDATE rr_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
          .bind(nowIso(now), await tokenHash(raw)).run();
      }
      const headers=new Headers({'Set-Cookie':clearSessionCookie()});headers.append('Set-Cookie',clearRoomCookie());
      return json({ ok:true },200,headers);
    }

    if (action === "admin") {
      const auth = await requireOwner(request, env, now);
      if (auth.response) return auth.response;
      await purgeExpiredOwnerArtifacts(env, now);
      const [members,sessions]=await Promise.all([
        env.DB.prepare(`SELECT m.id,m.display_name,rm.role,rm.joined_at AS created_at,rm.revoked_at FROM rr_room_members rm JOIN rr_members m ON m.id=rm.member_id WHERE rm.room_id=? ORDER BY rm.joined_at DESC`).bind(auth.room!.id).all<RoomMember>(),
        // Session tokens belong to a global identity. A room owner may manage only their own
        // devices, since signing out another person would affect that person's other rooms.
        env.DB.prepare(`SELECT s.token_hash,s.member_id,s.device_label,s.created_at,s.expires_at,s.revoked_at,m.display_name,rm.role
          FROM rr_sessions s JOIN rr_members m ON m.id=s.member_id JOIN rr_room_members rm ON rm.member_id=m.id
          WHERE rm.room_id=? AND s.member_id=? ORDER BY s.created_at DESC LIMIT 100`).bind(auth.room!.id,auth.member!.id).all<Record<string,unknown>>()
      ]);
      return json({members:members.results??[],sessions:(sessions.results??[]).map(({token_hash,...session})=>({...session,sessionId:token_hash})),room:publicRoom(auth.room!)});
    }

    if (action === "invite") {
      const auth = await requireOwner(request, env, now);
      if (auth.response || !auth.member) return auth.response ?? denied(401, "Sign in required.");
      const body = await readJson(request);
      if (!body) return denied(400, "Invalid request.");
      await purgeExpiredOwnerArtifacts(env, now);
      const purpose = body.purpose === "device" ? "device" : body.purpose === undefined || body.purpose === "member" ? "member" : "invalid";
      if (purpose === "invalid") return denied(400, "Invitation purpose must be member or device.");
      const articleId=typeof body.articleId==='string'?body.articleId:'';
      if(body.articleId!==undefined&&(!articleId||articleId.length>200||purpose!=='member'))return denied(400,'A valid article is required.');
      if(articleId&&!await env.DB.prepare('SELECT 1 AS found FROM rr_room_articles WHERE room_id=? AND page_id=?').bind(auth.room!.id,articleId).first())return denied(404,'Article not found in this room.');
      const token=randomToken(),memberId=purpose==='device'?auth.member.id:crypto.randomUUID(),createdAt=nowIso(now),expiresAt=plusDays(MEMBER_INVITE_DAYS,now);
      const inserted=await env.DB.prepare(`INSERT INTO rr_invites(token_hash,member_id,created_by,purpose,created_at,expires_at,room_id,article_id)
        SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM rr_invites WHERE room_id=? AND used_at IS NULL AND expires_at>?)<100
        AND (? IS NULL OR (SELECT COUNT(*) FROM rr_invites WHERE room_id=? AND article_id=? AND substr(created_at,1,10)=?)<15)`)
        .bind(await tokenHash(token),memberId,auth.member.id,purpose,createdAt,expiresAt,auth.room!.id,articleId||null,auth.room!.id,nowIso(now),articleId||null,auth.room!.id,articleId||null,createdAt.slice(0,10)).run();
      if((inserted.meta?.changes??0)!==1){
        if(articleId){const daily=await env.DB.prepare('SELECT COUNT(*) AS n FROM rr_invites WHERE room_id=? AND article_id=? AND substr(created_at,1,10)=?').bind(auth.room!.id,articleId,createdAt.slice(0,10)).first<{n:number}>();if(Number(daily?.n||0)>=15)return denied(429,'This article has reached 15 new invitation links today (UTC). Share its existing private article link or try tomorrow.');}
        return denied(429,'There are already 100 active invitations in this room. Let some expire before creating another.');
      }
      const joinUrl=new URL('/room',request.url);
      if(articleId)joinUrl.searchParams.set('next',`/read/${encodeURIComponent(articleId)}?room=${encodeURIComponent(auth.room!.id)}`);
      joinUrl.hash=`invite=${token}&purpose=${purpose}`;
      return json({url:joinUrl.toString(),expiresAt,role:purpose==='device'?'owner':'member',purpose},201);
    }

    if (action === "revoke-session") {
      const auth = await requireOwner(request, env, now);
      if (auth.response || !auth.member) return auth.response ?? denied(401, "Sign in required.");
      await purgeExpiredOwnerArtifacts(env, now);
      const body = await readJson(request);
      const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
      if (!TOKEN_RE.test(sessionId)) return denied(400, "A valid session id is required.");
      const currentToken = cookieValue(request, MEMBER_SESSION_COOKIE);
      if (currentToken && sessionId === await tokenHash(currentToken)) return json({ revoked: false, reason: "current-device" });
      const result = await env.DB.prepare(`UPDATE rr_sessions SET revoked_at=? WHERE token_hash=? AND member_id=? AND revoked_at IS NULL`)
        .bind(nowIso(now), sessionId, auth.member.id).run();
      return json({ revoked: (result.meta?.changes ?? 0) > 0 });
    }

    if (action === "revoke-member") {
      const auth = await requireOwner(request, env, now);
      if (auth.response || !auth.member) return auth.response ?? denied(401, "Sign in required.");
      await purgeExpiredOwnerArtifacts(env, now);
      const body = await readJson(request);
      const memberId = typeof body?.memberId === "string" ? body.memberId : "";
      if (!memberId || memberId === auth.member.id) return denied(400, "Choose a different member.");
      const member=await env.DB.prepare('SELECT member_id AS id,role FROM rr_room_members WHERE room_id=? AND member_id=? AND revoked_at IS NULL').bind(auth.room!.id,memberId).first<{id:string;role:string}>();
      if(!member||member.role!=='member')return denied(404,'Member not found in this room.');
      await env.DB.prepare("UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=? AND role='member'").bind(nowIso(now),auth.room!.id,memberId).run();
      return json({ revoked: true });
    }

    return denied(404, "Unknown member-auth action.");
  } catch {
    return denied(500, "Member authentication is temporarily unavailable.");
  }
}

/** Public shell routes; the outer Sites Worker should allow these through its member gate. */
export function isPublicMemberAuthPath(pathname: string): boolean {
  return pathname === "/room" || pathname === "/api/member-auth";
}

/**
 * Gate an application request. Returns either an HTTP response or a sanitized Request that the
 * caller may pass to Assets/Vinext. The caller should exempt isPublicMemberAuthPath first.
 */
export async function memberAuthGate(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<Response | Request> {
  await ensureRooms(env);
  const identity = await sessionMember(request, env, now);
  const room=identity?await memberRoom(request,env,identity.id):null;
  if (!identity||(!room&&new URL(request.url).pathname!=='/api/rooms')) {
    if (new URL(request.url).pathname.startsWith("/api/")) return denied(401, "Sign in to this private room.");
    const requestUrl = new URL(request.url);
    const target = new URL("/room", request.url);
    target.searchParams.set("next", safeMemberNextPath(`${requestUrl.pathname}${requestUrl.search}`));
    return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "private, no-store" } });
  }
  const headers = new Headers(request.headers);
  for (const name of OAI_HEADERS) headers.delete(name);
  headers.delete('x-rr-room-id');
  headers.delete('x-ret-member-id');
  headers.delete('x-ret-member-role');
  headers.set('x-ret-member-id',identity.id);
  if(room){headers.set('x-rr-room-id',room.id);headers.set('x-ret-member-role',room.role);}
  // This header is minted only from a validated owner session. All incoming OAI identity headers
  // are stripped first, so a member cannot spoof owner access through request headers.
  if (room?.role === "owner" && env.READER_OWNER_EMAIL) headers.set("oai-authenticated-user-email", env.READER_OWNER_EMAIL);
  return new Request(request, { headers });
}

export async function memberAuthFetch(request: Request, env: MemberAuthEnv): Promise<Response | Request> {
  if (new URL(request.url).pathname === "/api/member-auth") return memberAuthAPI(request, env);
  return memberAuthGate(request, env);
}

/** Room management authenticates the global session directly, including after leaving a room. */
export async function roomsAPI(request: Request, env: MemberAuthEnv, now=Date.now()): Promise<Response> {
  if(request.method!=='GET'&&request.method!=='POST')return denied(405,'Method not allowed.');
  if(request.method==='POST'){const csrf=sameOriginWrite(request);if(csrf)return csrf;}
  try {
    await ensureRooms(env);
    const member=await sessionMember(request,env,now);
    if(!member)return denied(401,'Sign in to manage your rooms.');
    if(request.method==='GET') {
      const rooms=await env.DB.prepare(`SELECT r.id,r.name,rm.role FROM rr_rooms r JOIN rr_room_members rm ON rm.room_id=r.id WHERE rm.member_id=? AND rm.revoked_at IS NULL ORDER BY r.created_at,r.id`).bind(member.id).all<{id:string;name:string;role:string}>();
      const active=await memberRoom(request,env,member.id);
      return json({rooms:rooms.results??[],activeRoom:active?publicRoom(active):null,member:{id:member.id,displayName:member.display_name}});
    }
    const body=await readJson(request);
    if(!body)return denied(400,'Invalid request.');
    const action=body.action;
    if(action==='create') {
      const name=typeof body.name==='string'?body.name.trim().slice(0,80):'';
      if(!name)return denied(400,'Give your room a name.');
      const id=crypto.randomUUID(),createdAt=nowIso(now);
      const created=await env.DB.prepare("INSERT INTO rr_rooms(id,name,owner_id,created_at,moderation) SELECT ?,?,?,?,'open' WHERE (SELECT COUNT(*) FROM rr_rooms WHERE owner_id=?)<20").bind(id,name,member.id,createdAt,member.id).run();
      if((created.meta?.changes??0)!==1)return denied(429,'You can own up to 20 rooms. Use one of your existing rooms.');
      await env.DB.prepare("INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,'owner',?)").bind(id,member.id,createdAt).run();
      return json({room:{id,name,role:'owner',moderation:'open'},nextPath:'/capture'},201,{'Set-Cookie':roomCookie(id)});
    }
    if(action==='switch') {
      const target=typeof body.roomId==='string'?body.roomId:'';
      if(!target)return denied(400,'Choose a room.');
      const room=await env.DB.prepare(`SELECT r.*,rm.role,rm.member_id FROM rr_rooms r JOIN rr_room_members rm ON rm.room_id=r.id WHERE r.id=? AND rm.member_id=? AND rm.revoked_at IS NULL`).bind(target,member.id).first<ActiveRoom>();
      if(!room)return denied(403,'You do not have access to this room.');
      return json({room:publicRoom(room),nextPath:'/capture'},200,{'Set-Cookie':roomCookie(room.id)});
    }
    const room=await memberRoom(request,env,member.id);
    if(!room)return denied(403,'Select a room you belong to.');
    if(action==='leave') {
      if(room.role==='owner')return denied(409,'The owner cannot leave their room.');
      await env.DB.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').bind(nowIso(now),room.id,member.id).run();
      return json({left:true,nextPath:'/room'},200,{'Set-Cookie':clearRoomCookie()});
    }
    if(action==='rename'||action==='moderation') {
      if(room.role!=='owner')return denied(403,'Only the owner can change this room.');
      if(action==='rename') {
        const name=typeof body.name==='string'?body.name.trim().slice(0,80):'';
        if(!name)return denied(400,'Give your room a name.');
        await env.DB.prepare('UPDATE rr_rooms SET name=? WHERE id=? AND owner_id=?').bind(name,room.id,member.id).run();room.name=name;
      } else {
        if(body.moderation!=='open'&&body.moderation!=='approval')return denied(400,'Choose open or approval moderation.');
        await env.DB.prepare('UPDATE rr_rooms SET moderation=? WHERE id=? AND owner_id=?').bind(body.moderation,room.id,member.id).run();room.moderation=body.moderation;
      }
      return json({room:publicRoom(room),nextPath:'/room'});
    }
    return denied(400,'Unknown room action.');
  } catch {return denied(500,'Rooms are temporarily unavailable.');}
}
