import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationDestination } from './welcome-link.mjs';

const origin = 'https://dayofflondon.com';
const token = 'a'.repeat(64);

test('accepts a same-origin member invitation and preserves safe next query', () => {
  const value = `/room?next=${encodeURIComponent('/article/reading-list') }#invite=${token}`;
  assert.equal(invitationDestination(value, origin), value);
});

test('accepts relative and absolute same-origin invitations', () => {
  assert.equal(invitationDestination(`/room#invite=${token}`, origin), `/room#invite=${token}`);
  assert.equal(invitationDestination(`https://dayofflondon.com/room#invite=${token}`, origin), `/room#invite=${token}`);
});

test('rejects external origins, credentials, javascript, and non-room paths', () => {
  for (const value of [
    `https://evil.example/room#invite=${token}`,
    `https://user:pass@dayofflondon.com/room#invite=${token}`,
    `javascript:alert(1)`,
    `/capture#invite=${token}`,
    `//evil.example/room#invite=${token}`,
  ]) assert.equal(invitationDestination(value, origin), null, value);
});

test('rejects recovery, device, other-purpose, duplicate, malformed and missing tokens', () => {
  for (const fragment of [
    `recover=${token}`,
    `invite=${token}&purpose=device`,
    `invite=${token}&purpose=owner`,
    `invite=${token}&purpose=member&purpose=member`,
    `invite=${token}&recover=${token}`,
    `invite=${'A'.repeat(64)}`,
    `invite=${'b'.repeat(63)}`,
    'invite=abc',
    '',
  ]) assert.equal(invitationDestination(`/room#${fragment}`, origin), null, fragment);
});

test('rejects crafted paths and invalid origins', () => {
  for (const path of [`/room/../capture`, `/room/%2f..%2fcapture`, `/ROOM`, `/room\..\capture`]) {
    assert.equal(invitationDestination(`${path}#invite=${token}`, origin), null, path);
  }
  assert.equal(invitationDestination(`/room#invite=${token}`, 'javascript:alert(1)'), null);
});
