import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { normalizeApnsPrivateKey } from './pushNotifications.js';

function samplePem(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

test('rebuilds a one-line Railway PEM with spaces instead of newlines', () => {
  const pem = samplePem();
  const flattened = pem.replace(/\n/g, ' ');
  const normalized = normalizeApnsPrivateKey(flattened);
  assert.match(normalized, /-----BEGIN PRIVATE KEY-----/);
  assert.match(normalized, /-----END PRIVATE KEY-----/);
  assert.ok(normalized.includes('\n'));
  assert.equal(normalized.replace(/\s+/g, ''), pem.replace(/\s+/g, ''));
});

test('expands literal \\n and strips wrapping quotes', () => {
  const pem = samplePem();
  const quoted = `"${pem.replace(/\n/g, '\\n')}"`;
  const normalized = normalizeApnsPrivateKey(quoted);
  assert.equal(normalized.replace(/\s+/g, ''), pem.replace(/\s+/g, ''));
});

test('accepts a full PEM file encoded as base64', () => {
  const pem = samplePem();
  const encoded = Buffer.from(pem, 'utf8').toString('base64');
  const normalized = normalizeApnsPrivateKey(encoded);
  assert.equal(normalized.replace(/\s+/g, ''), pem.replace(/\s+/g, ''));
});
