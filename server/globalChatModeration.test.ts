import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockChatUser,
  createGlobalChatMessage,
  hasProhibitedChatContent,
  listBlockedChatUserIds,
  listGlobalChatMessages,
  reportGlobalChatMessage,
  unblockChatUser,
} from './globalChatStore.js';

test('rejects hateful and threatening chat content', () => {
  assert.equal(hasProhibitedChatContent('sale nègre'), true);
  assert.equal(hasProhibitedChatContent('va te suicider'), true);
  assert.equal(hasProhibitedChatContent('I will kill you'), true);
});

test('normalizes common obfuscation before moderation', () => {
  assert.equal(hasProhibitedChatContent('k!ll yourself'), true);
  assert.equal(hasProhibitedChatContent('Wh1te p0wer'), true);
});

test('allows normal competition discussion', () => {
  assert.equal(hasProhibitedChatContent('Belle performance, bonne chance pour la finale !'), false);
  assert.equal(hasProhibitedChatContent('Je préfère attendre une confirmation avant de trader.'), false);
});

test('persists blocks and hides blocked authors from chat reads', async () => {
  const author = { id: 'moderation-author', name: 'Author' };
  const viewerId = 'moderation-viewer';
  await createGlobalChatMessage(author, { body: 'Message visible avant blocage' });
  await blockChatUser(viewerId, author.id);
  assert.deepEqual(await listBlockedChatUserIds(viewerId), [author.id]);
  const hidden = await listGlobalChatMessages({ viewerUserId: viewerId });
  assert.equal(hidden.some((message) => message.userId === author.id), false);
  await unblockChatUser(viewerId, author.id);
  assert.deepEqual(await listBlockedChatUserIds(viewerId), []);
});

test('accepts a valid report and rejects self-reporting', async () => {
  const message = await createGlobalChatMessage(
    { id: 'reported-author', name: 'Reported author' },
    { body: 'Message à examiner' },
  );
  const created = await reportGlobalChatMessage({
    reporterUserId: 'reporter',
    messageId: message.id,
    reason: 'spam',
  });
  const duplicate = await reportGlobalChatMessage({
    reporterUserId: 'reporter',
    messageId: message.id,
    reason: 'spam',
  });
  assert.equal(created, true);
  assert.equal(duplicate, false);
  await assert.rejects(
    reportGlobalChatMessage({
      reporterUserId: 'reported-author',
      messageId: message.id,
      reason: 'other',
    }),
    /propre message/,
  );
});
