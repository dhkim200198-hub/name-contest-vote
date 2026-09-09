import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyRound1, tallyRound2 } from '../lib/tally.js';

test('1차: 순위별 가중치가 정확히 합산된다', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const weights = [60, 30, 10, 0];
  const ballots = [
    { ranking: ['a', 'b', 'c', 'd'] }, // a60 b30 c10 d0
    { ranking: ['b', 'a', 'd', 'c'] }, // b60 a30 d10 c0
    { ranking: ['a', 'c'] }, // a60 c30
  ];
  const { rows, totalBallots } = tallyRound1(ballots, weights, ids);
  assert.equal(totalBallots, 3);
  const score = Object.fromEntries(rows.map((r) => [r.id, r.score]));
  assert.equal(score.a, 150);
  assert.equal(score.b, 90);
  assert.equal(score.c, 40);
  assert.equal(score.d, 10);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].rank, 1);
});

test('1차: 동점이면 1순위표가 많은 쪽이 앞선다', () => {
  const ids = ['x', 'y'];
  const weights = [10, 5];
  const ballots = [
    { ranking: ['x', 'y'] }, // x10 y5
    { ranking: ['y', 'x'] }, // y10 x5
    { ranking: ['x'] }, // x10
    { ranking: ['y'] }, // y10  => x25/1st2, y25/1st2 ... tie
  ];
  const { rows } = tallyRound1(ballots, weights, ids);
  assert.equal(rows[0].score, 25);
  assert.equal(rows[1].score, 25);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, 1); // 완전 동점 → 같은 순위
});

test('2차: 보르다 점수가 합산되고 1위가 정해진다', () => {
  const ids = ['p', 'q', 'r'];
  const points = [5, 4, 3, 2, 1];
  const ballots = [
    { ranking: ['p', 'q', 'r'] }, // p5 q4 r3
    { ranking: ['q', 'p', 'r'] }, // q5 p4 r3
    { ranking: ['p', 'r', 'q'] }, // p5 r4 q3
  ];
  const { rows } = tallyRound2(ballots, points, ids);
  const score = Object.fromEntries(rows.map((r) => [r.id, r.score]));
  assert.equal(score.p, 14);
  assert.equal(score.q, 12);
  assert.equal(score.r, 10);
  assert.equal(rows[0].id, 'p');
});

test('범위 밖 후보 id 는 무시된다', () => {
  const { rows } = tallyRound2([{ ranking: ['p', 'ZZZ', 'q'] }], [5, 4, 3], ['p', 'q']);
  const score = Object.fromEntries(rows.map((r) => [r.id, r.score]));
  assert.equal(score.p, 5);
  assert.equal(score.q, 3); // ZZZ 가 인덱스 1을 먹고, q 는 인덱스 2(=3점)
});
