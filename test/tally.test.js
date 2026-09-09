import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyRound1, tallyRound2 } from '../lib/tally.js';

test('1차: 자유 배분 점수가 합산된다', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const ballots = [
    { allocations: [{ id: 'a', points: 60 }, { id: 'b', points: 30 }, { id: 'c', points: 10 }] },
    { allocations: [{ id: 'b', points: 100 }] },
    { allocations: [{ id: 'a', points: 50 }, { id: 'c', points: 50 }] },
  ];
  const { rows, totalBallots } = tallyRound1(ballots, ids);
  assert.equal(totalBallots, 3);
  const score = Object.fromEntries(rows.map((r) => [r.id, r.score]));
  assert.equal(score.a, 110);
  assert.equal(score.b, 130);
  assert.equal(score.c, 60);
  assert.equal(score.d, 0);
  assert.equal(rows[0].id, 'b');
  assert.equal(rows[0].rank, 1);
});

test('1차: firsts = 그 표에서 최고 배점을 받은 이름', () => {
  const ids = ['x', 'y'];
  const ballots = [
    { allocations: [{ id: 'x', points: 70 }, { id: 'y', points: 30 }] }, // x top
    { allocations: [{ id: 'y', points: 60 }, { id: 'x', points: 40 }] }, // y top
    { allocations: [{ id: 'x', points: 100 }] }, // x top
  ];
  const { rows } = tallyRound1(ballots, ids);
  const firsts = Object.fromEntries(rows.map((r) => [r.id, r.firsts]));
  assert.equal(firsts.x, 2);
  assert.equal(firsts.y, 1);
});

test('1차: 범위 밖 id 는 무시된다', () => {
  const { rows } = tallyRound1([{ allocations: [{ id: 'a', points: 40 }, { id: 'ZZ', points: 60 }] }], ['a', 'b']);
  const score = Object.fromEntries(rows.map((r) => [r.id, r.score]));
  assert.equal(score.a, 40);
  assert.equal(score.b, 0);
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

test('2차: 완전 동점이면 같은 순위', () => {
  const { rows } = tallyRound2(
    [{ ranking: ['x', 'y'] }, { ranking: ['y', 'x'] }],
    [10, 5],
    ['x', 'y'],
  );
  assert.equal(rows[0].score, 15);
  assert.equal(rows[1].score, 15);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, 1);
});
