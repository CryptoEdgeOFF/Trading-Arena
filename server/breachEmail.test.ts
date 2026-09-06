import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBreachGiftOffers,
  formatDrawdownPercentLabel,
  isMainBlueberryArena,
  shouldQueueBreachEmail,
} from './breachEmail.js';

test('breach email is queued only on a fresh elimination', () => {
  assert.equal(shouldQueueBreachEmail({ newlyBreached: true }), true);
  assert.equal(shouldQueueBreachEmail({ newlyBreached: false }), false);
});

test('main Blueberry arenas match title or sponsor, not blitz or staging', () => {
  assert.equal(isMainBlueberryArena({
    title: 'BTF x BLUEBERRY',
    sponsorName: 'Blueberry Markets',
    isPublic: true,
  }), true);
  assert.equal(isMainBlueberryArena({
    title: 'Weekly Cup',
    sponsor: 'blueberry',
    isPublic: true,
  }), true);
  assert.equal(isMainBlueberryArena({
    title: 'BTF x BLUEBERRY',
    isPublic: false,
  }), false);
  assert.equal(isMainBlueberryArena({
    title: 'BTF x BLUEBERRY',
    format: 'blitz',
    isPublic: true,
  }), false);
  assert.equal(isMainBlueberryArena({
    title: 'STAGING Blueberry',
    isPublic: true,
  }), false);
  assert.equal(isMainBlueberryArena({
    title: 'Friday Night Arena',
    isPublic: true,
  }), false);
});

test('gift offers fall back to the Blueberry promo codes', () => {
  assert.deepEqual(buildBreachGiftOffers({}), [
    { title: '-50 % sur vos challenges PRIMES', code: 'BTF50' },
    { title: '-30 % sur tous les Challenges', code: 'BTF35' },
  ]);
  assert.deepEqual(buildBreachGiftOffers({
    promoOffer1: '-40 % Prime',
    promoCode1: 'BB40',
  }), [{ title: '-40 % Prime', code: 'BB40' }]);
});

test('drawdown percent uses a French decimal', () => {
  assert.equal(formatDrawdownPercentLabel(5), '5');
  assert.equal(formatDrawdownPercentLabel(5.5), '5,5');
  assert.equal(formatDrawdownPercentLabel(null), '5');
});
