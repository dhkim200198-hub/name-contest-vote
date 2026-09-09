// 집계 로직 (순수 함수 — test/tally.test.js 로 검증)

function rank(rows) {
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
  return rows;
}

// 1차: 각 표는 allocations [{id, points}] — 100점(tokenBudget)을 이름들에 자유 배분한 것.
// firsts = "그 표에서 가장 많은 점수를 받은 이름" 카운트 (동점 정렬용).
export function tallyRound1(ballots, candidateIds) {
  const score = new Map(candidateIds.map((id) => [id, 0]));
  const firsts = new Map(candidateIds.map((id) => [id, 0]));

  for (const b of ballots) {
    const allocs = Array.isArray(b.allocations) ? b.allocations : [];
    let topId = null;
    let topPts = 0;
    for (const a of allocs) {
      if (!score.has(a.id)) continue;
      const p = Number(a.points) || 0;
      score.set(a.id, score.get(a.id) + p);
      if (p > topPts) {
        topPts = p;
        topId = a.id;
      }
    }
    if (topId && topPts > 0) firsts.set(topId, firsts.get(topId) + 1);
  }

  const rows = candidateIds.map((id) => ({ id, score: score.get(id), firsts: firsts.get(id) }));
  return { rows: rank(rows), totalBallots: ballots.length };
}

// 2차: 각 표는 ranking [id...] — 순위별 고정 점수(보르다) 부여.
export function tallyRound2(ballots, points, candidateIds) {
  const score = new Map(candidateIds.map((id) => [id, 0]));
  const firsts = new Map(candidateIds.map((id) => [id, 0]));

  for (const b of ballots) {
    const ranking = Array.isArray(b.ranking) ? b.ranking : [];
    ranking.forEach((cid, idx) => {
      if (!score.has(cid)) return;
      if (idx < points.length) score.set(cid, score.get(cid) + (Number(points[idx]) || 0));
      if (idx === 0) firsts.set(cid, firsts.get(cid) + 1);
    });
  }

  const rows = candidateIds.map((id) => ({ id, score: score.get(id), firsts: firsts.get(id) }));
  return { rows: rank(rows), totalBallots: ballots.length };
}
