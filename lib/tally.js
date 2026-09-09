// 집계 로직 (순수 함수 — test/tally.test.js 로 검증)

// values: 순위별 점수 배열. 1차는 가중치(예 [60,30,10,0]), 2차는 보르다 점수(예 [5,4,3,2,1]).
function tally(ballots, values, candidateIds) {
  const score = new Map(candidateIds.map((id) => [id, 0]));
  const firsts = new Map(candidateIds.map((id) => [id, 0])); // 1순위로 지목된 횟수 (동점 비교용)

  for (const b of ballots) {
    const ranking = Array.isArray(b.ranking) ? b.ranking : [];
    ranking.forEach((cid, idx) => {
      if (!score.has(cid)) return;
      if (idx < values.length) score.set(cid, score.get(cid) + (Number(values[idx]) || 0));
      if (idx === 0) firsts.set(cid, firsts.get(cid) + 1);
    });
  }

  const rows = candidateIds.map((id) => ({ id, score: score.get(id), firsts: firsts.get(id) }));
  rows.sort((a, b) => b.score - a.score || b.firsts - a.firsts);

  let prevKey = null;
  let prevRank = 0;
  rows.forEach((r, i) => {
    const key = `${r.score}|${r.firsts}`;
    if (key !== prevKey) {
      prevRank = i + 1;
      prevKey = key;
    }
    r.rank = prevRank;
  });

  return { rows, totalBallots: ballots.length };
}

export function tallyRound1(ballots, weights, candidateIds) {
  return tally(ballots, weights, candidateIds);
}

export function tallyRound2(ballots, points, candidateIds) {
  return tally(ballots, points, candidateIds);
}
