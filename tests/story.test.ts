// Story Mode rules: stars, unlocks, coins, decorations. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allDone, buy, DECOR, finishLevel, LEVEL_COUNT, levelUnlocked, lookUnlocked, newProgress, nextLevel, starsFor, totalStars, weekUnlocked,
} from '../src/story/progress.ts';

test('stars: experimenting is never punished below one star', () => {
  assert.equal(starsFor(0), 3);
  assert.equal(starsFor(1), 3);
  assert.equal(starsFor(2), 2);
  assert.equal(starsFor(3), 2);
  assert.equal(starsFor(4), 1);
  assert.equal(starsFor(50), 1);
});

test('levels unlock one at a time and PLAY goes to the first unfinished level', () => {
  const p = newProgress();
  assert.equal(nextLevel(p), 0);
  assert.ok(levelUnlocked(p, 0));
  assert.ok(!levelUnlocked(p, 1));
  const r = finishLevel(p, 0, 0, 10);
  assert.equal(r.stars, 3);
  assert.equal(r.unlocked, 1);
  assert.ok(levelUnlocked(p, 1));
  assert.equal(nextLevel(p), 1);
  assert.equal(p.coins, 10);
});

test('replaying keeps the best stars and does not re-announce unlocks', () => {
  const p = newProgress();
  finishLevel(p, 0, 0, 0);
  const again = finishLevel(p, 0, 9, 5);
  assert.equal(again.stars, 1);
  assert.equal(again.best, false);
  assert.equal(again.unlocked, null);
  assert.equal(p.stars[0], 3);
  assert.equal(p.coins, 5);
});

test('Full Week mode opens after all levels; player looks unlock by stars', () => {
  const p = newProgress();
  assert.ok(lookUnlocked(p, 0));
  assert.ok(!lookUnlocked(p, 1));
  for (let i = 0; i < LEVEL_COUNT; i++) {
    assert.ok(!weekUnlocked(p));
    finishLevel(p, i, 0, 0);
  }
  assert.ok(allDone(p));
  assert.ok(weekUnlocked(p));
  assert.equal(totalStars(p), 15);
  assert.ok(lookUnlocked(p, 2));
  assert.equal(nextLevel(p), LEVEL_COUNT - 1);
});

test('decorations cost game coins, can only be bought once, and never go negative', () => {
  const p = newProgress();
  const d = DECOR[0];
  assert.equal(buy(p, d.id), false);
  p.coins = d.cost;
  assert.equal(buy(p, d.id), true);
  assert.equal(p.coins, 0);
  assert.equal(buy(p, d.id), false);
  assert.equal(buy(p, 'nope'), false);
  assert.deepEqual(p.owned, [d.id]);
});
