/**
 * Validate a pasted member invitation and return the existing /room route.
 * Invite tokens stay in the fragment, so they are not sent in the HTTP request.
 */
export function invitationDestination(value, origin) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;

  let base;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null;

  let invitation;
  try {
    invitation = new URL(value, base.origin);
  } catch {
    return null;
  }
  if (invitation.origin !== base.origin || invitation.username || invitation.password) return null;
  if (invitation.pathname !== '/room') return null;

  // Do not accept encoded or alternate path forms that a server/proxy could normalize.
  if (invitation.pathname !== new URL(invitation.href).pathname || /%2f|%5c/i.test(invitation.pathname)) return null;

  const fragment = invitation.hash.slice(1);
  const params = new URLSearchParams(fragment);
  const tokenValues = params.getAll('invite');
  if (tokenValues.length !== 1 || !/^[a-f0-9]{64}$/.test(tokenValues[0])) return null;
  if (params.has('recover')) return null;
  const purposes = params.getAll('purpose');
  if (purposes.length > 1 || (purposes.length === 1 && purposes[0] !== 'member')) return null;

  // Keep the safe query, including the existing /room next handoff. Never move the token
  // out of the fragment or interpret it as a destination of its own.
  return `${invitation.pathname}${invitation.search}${invitation.hash}`;
}
