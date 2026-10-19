import { memberAuthAPI, sessionMember, type MemberAuthEnv } from './member-auth.ts';
import { DEFAULT_ROOM_ID, memberRoom } from './rooms.ts';

const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...Object.fromEntries(new Headers(headers)) } });
const denied = (status: number, error: string) => json({ error }, status);
const stamp = (now: number) => new Date(now).toISOString();
const received = () => json({ requested: true }, 202);
type MembershipRequest = { id: string; name: string; email: string; message: string; status: string; created_at: string; updated_at: string; expires_at: string };

// The public landing page is for this owner's original room. A posted room ID, role,
// or identity header can never redirect a request or create membership.
async function ensureRequests(env: MemberAuthEnv, now: number) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS rr_membership_requests (
    id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL REFERENCES rr_rooms(id),
    name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', rate_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS rr_membership_requests_room ON rr_membership_requests(room_id,status,created_at)').run();
  await env.DB.prepare('DELETE FROM rr_membership_requests WHERE expires_at<=?').bind(stamp(now)).run();
  await env.DB.prepare("UPDATE rr_membership_requests SET status='pending' WHERE status='preparing' AND updated_at<?").bind(stamp(now - 300_000)).run();
}

async function input(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') || !request.body || Number(request.headers.get('Content-Length') || 0) > 4096) return null;
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

async function owner(request: Request, env: MemberAuthEnv, now: number) {
  const member = await sessionMember(request, env, now);
  if (!member) return { response: denied(401, 'Sign in to review invitation requests.') };
  const room = await memberRoom(request, env, member.id);
  if (!room || room.role !== 'owner') return { response: denied(403, 'Only the room owner can review invitation requests.') };
  return { room };
}

export async function membershipRequestAPI(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<Response> {
  const action = new URL(request.url).searchParams.get('action');
  if (request.method !== (action === 'invitation-requests' ? 'GET' : 'POST')) return denied(405, 'Method not allowed.');
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.get('X-Reading-Room') !== '1') return denied(403, 'Send the request from Reading Room.');
  }
  if (action === 'request-invitation') {
    const body = await input(request);
    if (!body) return denied(400, 'Check your request and try again.');
    if (typeof body.website === 'string' && body.website.trim()) return received();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) || message.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) return denied(400, 'Enter your name, a valid email address and a note of up to 500 characters.');
    const target = await env.DB.prepare(`SELECT r.id FROM rr_rooms r JOIN rr_members m ON m.id=r.owner_id
      JOIN rr_room_members rm ON rm.room_id=r.id AND rm.member_id=r.owner_id
      WHERE r.id=? AND m.revoked_at IS NULL AND rm.revoked_at IS NULL AND rm.role='owner'`).bind(DEFAULT_ROOM_ID).first();
    if (!target) return denied(503, 'Invitation requests are temporarily unavailable. Please try again later.');
    await ensureRequests(env, now);
    // Generic duplicate responses do not reveal whether an email has already requested access.
    if (await env.DB.prepare('SELECT id FROM rr_membership_requests WHERE room_id=? AND email=? LIMIT 1').bind(DEFAULT_ROOM_ID, email).first()) return received();
    const ip = (request.headers.get('CF-Connecting-IP') || '').slice(0, 64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('rr-request-v1:' + stamp(now).slice(0, 10) + ':' + ip));
    const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID(), createdAt = stamp(now), expiresAt = stamp(now + 30 * 86400_000);
    const result = await env.DB.prepare(`INSERT INTO rr_membership_requests(id,room_id,name,email,message,status,rate_hash,created_at,updated_at,expires_at)
      SELECT ?,?,?,?,?,'pending',?,?,?,? WHERE
      NOT EXISTS(SELECT 1 FROM rr_membership_requests WHERE room_id=? AND email=?) AND
      (SELECT COUNT(*) FROM rr_membership_requests WHERE created_at>=?)<100 AND
      (?='' OR (SELECT COUNT(*) FROM rr_membership_requests WHERE rate_hash=? AND created_at>=?)<5)`)
      .bind(id, DEFAULT_ROOM_ID, name, email, message, hash, createdAt, createdAt, expiresAt, DEFAULT_ROOM_ID, email, stamp(now - 86400_000), ip, hash, stamp(now - 86400_000)).run();
    if (!(result.meta?.changes)) {
      if (await env.DB.prepare('SELECT id FROM rr_membership_requests WHERE room_id=? AND email=? LIMIT 1').bind(DEFAULT_ROOM_ID, email).first()) return received();
      return json({ error: 'Too many invitation requests. Please try again later.' }, 429, { 'Retry-After': '3600' });
    }
    return received();
  }

  const auth = await owner(request, env, now);
  if (auth.response) return auth.response;
  if (auth.room!.id !== DEFAULT_ROOM_ID) return action === 'invitation-requests' ? json({ requests: [], enabled: false }) : denied(403, 'This request belongs to another room.');
  await ensureRequests(env, now);
  if (action === 'invitation-requests') {
    const rows = await env.DB.prepare(`SELECT id,name,email,message,status,created_at,updated_at,expires_at FROM rr_membership_requests
      WHERE room_id=? AND status<>'dismissed' ORDER BY created_at DESC LIMIT 100`).bind(DEFAULT_ROOM_ID).all<MembershipRequest>();
    return json({ requests: rows.results || [], enabled: true });
  }
  const body = await input(request);
  if (!body || typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id) || !['prepare', 'dismiss'].includes(String(body.decision))) return denied(400, 'Choose an invitation request.');
  if (body.decision === 'dismiss') {
    await env.DB.prepare("UPDATE rr_membership_requests SET status='dismissed',updated_at=? WHERE id=? AND room_id=? AND status<>'preparing'").bind(stamp(now), body.id, DEFAULT_ROOM_ID).run();
    return json({ archived: true });
  }
  const row = await env.DB.prepare(`UPDATE rr_membership_requests SET status='preparing',updated_at=?
    WHERE id=? AND room_id=? AND status IN ('pending','prepared') RETURNING id,name,email,message,status,created_at,updated_at,expires_at`).bind(stamp(now), body.id, DEFAULT_ROOM_ID).first<MembershipRequest>();
  if (!row) return denied(409, 'This request is being reviewed or has been archived. Refresh the list.');
  const invite = await memberAuthAPI(new Request(new URL('/api/member-auth?action=invite&room=' + DEFAULT_ROOM_ID, request.url), {
    method: 'POST', headers: request.headers, body: JSON.stringify({ purpose: 'member' })
  }), env, now);
  if (!invite.ok) {
    await env.DB.prepare("UPDATE rr_membership_requests SET status='pending',updated_at=? WHERE id=? AND status='preparing'").bind(stamp(now), body.id).run();
    return invite;
  }
  await env.DB.prepare("UPDATE rr_membership_requests SET status='prepared',updated_at=? WHERE id=? AND status='preparing'").bind(stamp(now), body.id).run();
  return json({ name: row.name, email: row.email, invitation: await invite.json() });
}
