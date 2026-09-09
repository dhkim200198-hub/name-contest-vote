import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as store from './lib/store.js';
import { tallyRound1, tallyRound2 } from './lib/tally.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    '\n[경고] ADMIN_PASSWORD 환경변수가 없습니다. 임시 비밀번호 "admin1234" 로 동작합니다.' +
      '\n       배포 전 반드시 ADMIN_PASSWORD 를 설정하세요.\n',
  );
}

await store.init();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

/* ------------------------------------------------------------------ */
/* 관리자 세션                                                          */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // token -> expiresAt(ms)
const SESSION_MS = 12 * 60 * 60 * 1000;

function issueToken() {
  const t = randomBytes(24).toString('hex');
  sessions.set(t, Date.now() + SESSION_MS);
  return t;
}
function validToken(t) {
  const exp = sessions.get(t);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(t);
    return false;
  }
  return true;
}
function requireAdmin(req, res, next) {
  const t = req.get('x-admin-token');
  if (!t || !validToken(t)) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
  next();
}

// 로그인 시도 제한 (IP 당 10분에 8회)
const loginHits = new Map();
function loginRecord(ip) {
  const now = Date.now();
  let rec = loginHits.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + 10 * 60 * 1000 };
    loginHits.set(ip, rec);
  }
  return rec;
}

/* ------------------------------------------------------------------ */
/* 공통 헬퍼                                                            */
/* ------------------------------------------------------------------ */
function votableCandidates(d) {
  // 이름이 있고, 상표 검토에서 '중복있음'으로 표시되지 않은 후보만 투표 대상
  return d.candidates
    .filter((c) => c.name && c.name.trim() && c.trademark !== '중복있음')
    .sort((a, b) => a.order - b.order);
}
function publicCandidate(c) {
  return { id: c.id, name: c.name, kind: c.kind, english: c.english, description: c.description };
}
function roundOf(phase) {
  if (phase === 'round1_open') return 1;
  if (phase === 'round2_open') return 2;
  return null;
}
function ballotList(d, round) {
  return round === 1 ? d.ballots.round1 : d.ballots.round2;
}
function seatsFull(d, round) {
  const cap = Number(d.config.expectedVoters) || 0;
  return cap > 0 && ballotList(d, round).length >= cap;
}
function validateRanking(ranking, allowedIds, maxLen) {
  if (!Array.isArray(ranking) || ranking.length === 0) return '선택된 이름이 없습니다.';
  if (ranking.some((x) => typeof x !== 'string')) return '잘못된 요청입니다.';
  if (ranking.length > maxLen) return `최대 ${maxLen}개까지 선택할 수 있습니다.`;
  if (new Set(ranking).size !== ranking.length) return '같은 이름을 중복해서 선택했습니다.';
  const allow = new Set(allowedIds);
  if (ranking.some((id) => !allow.has(id))) return '선택할 수 없는 이름이 포함되어 있습니다.';
  return null;
}

// 1차 자유 배분: allocations = [{id, points}], 합계 = budget, 각 0..budget
function validateAllocations(allocations, allowedIds, maxPicks, budget) {
  if (!Array.isArray(allocations) || allocations.length === 0) return '선택된 이름이 없습니다.';
  if (allocations.length > maxPicks) return `최대 ${maxPicks}개까지 선택할 수 있습니다.`;
  const allow = new Set(allowedIds);
  const seen = new Set();
  let sum = 0;
  for (const a of allocations) {
    if (!a || typeof a.id !== 'string' || !allow.has(a.id)) return '선택할 수 없는 이름이 포함되어 있습니다.';
    if (seen.has(a.id)) return '같은 이름을 중복해서 선택했습니다.';
    seen.add(a.id);
    const p = Number(a.points);
    if (!Number.isInteger(p) || p < 0 || p > budget) return `점수는 0~${budget} 사이 정수여야 합니다.`;
    sum += p;
  }
  if (sum !== budget) return `배분한 점수의 합이 ${budget}점이어야 합니다. (현재 ${sum}점)`;
  return null;
}

// 현재 활성 라운드의 투표 용지 정보
function ballotInfo(d, round) {
  const candidates = votableCandidates(d).map(publicCandidate);
  if (round === 1) {
    return {
      round: 1,
      candidates,
      maxPick: Math.min(d.config.round1.maxPicks, candidates.length),
      tokenBudget: d.config.round1.tokenBudget,
    };
  }
  return {
    round: 2,
    candidates,
    maxPick: Math.min(d.config.round2.points.length, candidates.length),
    points: d.config.round2.points,
  };
}

function buildResults(d) {
  const cfg = d.config;
  const cand = (id) => d.candidates.find((c) => c.id === id) || {};
  const label = (x) => ({ ...x, name: cand(x.id).name || x.id, english: cand(x.id).english || '' });
  const votableIds = votableCandidates(d).map((c) => c.id);

  // 종합 반영 비율 (기본 1 : 1). 각 라운드를 100점 만점으로 환산한 뒤 이 비율로 합산한다.
  const w1 = Number(cfg.round1.scoreWeight) >= 0 ? Number(cfg.round1.scoreWeight) : 1;
  const w2 = Number(cfg.round2.scoreWeight) >= 0 ? Number(cfg.round2.scoreWeight) : 1;
  const r1 = tallyRound1(d.ballots.round1, votableIds);
  const r2 = tallyRound2(d.ballots.round2, cfg.round2.points, votableIds);

  const r1Total = r1.rows.reduce((s, x) => s + x.score, 0) || 1; // 0 방지
  const r2Total = r2.rows.reduce((s, x) => s + x.score, 0) || 1;

  const s1 = Object.fromEntries(r1.rows.map((x) => [x.id, x]));
  const s2 = Object.fromEntries(r2.rows.map((x) => [x.id, x]));
  let combined = votableIds.map((id) => {
    const a = s1[id] || { score: 0, firsts: 0 };
    const b = s2[id] || { score: 0, firsts: 0 };
    const n1 = (a.score / r1Total) * 100 * w1; // 1차 환산 기여도 (라운드 총합 100×w1점)
    const n2 = (b.score / r2Total) * 100 * w2; // 2차 환산 기여도
    return {
      id,
      round1Score: n1,
      round2Score: n2,
      round1Raw: a.score,
      round2Raw: b.score,
      score: n1 + n2,
      firsts: a.firsts + b.firsts,
    };
  });
  combined.sort((a, b) => b.score - a.score || b.firsts - a.firsts);
  let pk = null;
  let pr = 0;
  combined.forEach((row, i) => {
    const key = `${row.score}|${row.firsts}`;
    if (key !== pk) {
      pr = i + 1;
      pk = key;
    }
    row.rank = pr;
  });
  combined = combined.map(label);

  const expected = Number(cfg.expectedVoters) || 0;
  return {
    phase: cfg.phase,
    title: cfg.title,
    subtitle: cfg.subtitle,
    prize: cfg.prize,
    expectedVoters: expected,
    combineRatio: { round1: w1, round2: w2 }, // 각 라운드 100점 환산 후 이 비율로 합산
    round1: {
      tokenBudget: cfg.round1.tokenBudget,
      maxPicks: cfg.round1.maxPicks,
      totalBallots: r1.totalBallots,
      expectedVoters: expected,
      rows: r1.rows.map(label),
    },
    round2: {
      points: cfg.round2.points,
      totalBallots: r2.totalBallots,
      expectedVoters: expected,
      rows: r2.rows.map(label),
    },
    combined,
    winner: combined.length ? combined[0] : null,
  };
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */
app.get('/api/state', (req, res) => {
  const d = store.getData();
  const cfg = d.config;
  const round = roundOf(cfg.phase);
  const out = {
    title: cfg.title,
    subtitle: cfg.subtitle,
    prize: cfg.prize,
    phase: cfg.phase,
    resultsPublic: cfg.resultsPublic,
    expectedVoters: Number(cfg.expectedVoters) || 0,
    useVoterNumbers: !!cfg.useVoterNumbers && (Number(cfg.expectedVoters) || 0) >= 1,
    activeRound: round,
  };
  if (round) {
    out.ballot = ballotInfo(d, round);
    out.count = ballotList(d, round).length;
    out.full = seatsFull(d, round);
  }
  res.json(out);
});

function numberMode(d) {
  return !!d.config.useVoterNumbers && (Number(d.config.expectedVoters) || 0) >= 1;
}
// 번호 방식일 때: 요청의 voterNumber 검증 → { n } 또는 { error }
function checkVoterNumber(d, round, raw) {
  const max = Number(d.config.expectedVoters) || 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return { error: `본인 번호(1~${max})를 정확히 입력하세요.` };
  if (ballotList(d, round).some((b) => b.voterNumber === n)) {
    return { error: `${n}번은 이미 이 라운드 투표를 완료했습니다.` };
  }
  return { n };
}

// 번호 방식: 투표 시작 전 본인 번호가 유효/미사용인지 확인
app.post('/api/vote/check', (req, res) => {
  const d = store.getData();
  const round = roundOf(d.config.phase);
  if (!round) return res.status(409).json({ error: '지금은 진행 중인 투표가 없습니다.' });
  if (seatsFull(d, round)) return res.status(409).json({ error: '예정된 투표 인원이 모두 참여하여 마감되었습니다.' });
  if (!numberMode(d)) return res.json({ ok: true }); // 번호 안 쓰면 통과
  const chk = checkVoterNumber(d, round, req.body?.voterNumber);
  if (chk.error) return res.status(409).json({ error: chk.error });
  res.json({ ok: true });
});

app.post('/api/vote/submit', (req, res) => {
  const d = store.getData();
  const round = roundOf(d.config.phase);
  if (!round) return res.status(409).json({ error: '지금은 진행 중인 투표가 없습니다.' });

  if (seatsFull(d, round)) {
    return res.status(409).json({ error: '예정된 투표 인원이 모두 참여하여 마감되었습니다.' });
  }

  const voterKey = String(req.body?.voterKey || '').slice(0, 64); // 부가 정보(디버깅용)
  const useNum = numberMode(d);
  let voterNumber = null;
  if (useNum) {
    const chk = checkVoterNumber(d, round, req.body?.voterNumber);
    if (chk.error) return res.status(409).json({ error: chk.error });
    voterNumber = chk.n;
  } else {
    if (!voterKey) return res.status(400).json({ error: '잘못된 요청입니다. 페이지를 새로고침해 주세요.' });
    if (ballotList(d, round).some((b) => b.voterKey === voterKey)) {
      return res.status(409).json({ error: '이 기기에서는 이미 투표를 완료했습니다.' });
    }
  }

  const allowedIds = votableCandidates(d).map((c) => c.id);
  const info = ballotInfo(d, round);
  const base = { voterNumber, voterKey, at: new Date().toISOString() };
  let entry;
  if (round === 1) {
    const allocations = (req.body?.allocations || []).map((a) => ({ id: a && a.id, points: Number(a && a.points) }));
    const err = validateAllocations(allocations, allowedIds, info.maxPick, d.config.round1.tokenBudget);
    if (err) return res.status(400).json({ error: err });
    entry = { ...base, allocations };
  } else {
    const ranking = req.body?.ranking;
    const err = validateRanking(ranking, allowedIds, info.maxPick);
    if (err) return res.status(400).json({ error: err });
    entry = { ...base, ranking };
  }

  let stored = false;
  store.mutate((data) => {
    const list = ballotList(data, round);
    if (seatsFull(data, round)) return;
    if (useNum && list.some((b) => b.voterNumber === voterNumber)) return;
    if (!useNum && list.some((b) => b.voterKey === voterKey)) return;
    list.push(entry);
    stored = true;
  });
  if (!stored) return res.status(409).json({ error: '방금 마감되었거나 이미 투표되었습니다.' });

  res.json({ ok: true, count: ballotList(store.getData(), round).length });
});

app.get('/api/results', (req, res) => {
  const d = store.getData();
  const closedOrLater = ['round1_closed', 'round2_open', 'round2_closed', 'done'].includes(d.config.phase);
  if (!d.config.resultsPublic && !closedOrLater) {
    return res.status(403).json({ error: '결과가 아직 공개되지 않았습니다.' });
  }
  res.json(buildResults(d));
});

/* ------------------------------------------------------------------ */
/* 관리자 API                                                          */
/* ------------------------------------------------------------------ */
app.post('/api/admin/login', (req, res) => {
  const rec = loginRecord(req.ip);
  if (rec.count >= 8) {
    return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    rec.count += 1;
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  rec.count = 0;
  res.json({ token: issueToken() });
});

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const d = store.getData();
  const nums = (list) =>
    list
      .map((b) => b.voterNumber)
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
  res.json({
    config: d.config,
    candidates: d.candidates,
    ballotCounts: { round1: d.ballots.round1.length, round2: d.ballots.round2.length },
    votedNumbers: { round1: nums(d.ballots.round1), round2: nums(d.ballots.round2) },
    results: buildResults(d),
  });
});

app.put('/api/admin/config', requireAdmin, (req, res) => {
  const b = req.body || {};
  store.mutate((d) => {
    const c = d.config;
    if (typeof b.title === 'string') c.title = b.title.slice(0, 120);
    if (typeof b.subtitle === 'string') c.subtitle = b.subtitle.slice(0, 200);
    if (Number.isFinite(b.prize) && b.prize >= 0) c.prize = Math.round(b.prize);
    if (typeof b.resultsPublic === 'boolean') c.resultsPublic = b.resultsPublic;
    if (typeof b.useVoterNumbers === 'boolean') c.useVoterNumbers = b.useVoterNumbers;
    if (Number.isFinite(b.expectedVoters) && b.expectedVoters >= 0) {
      c.expectedVoters = Math.min(100000, Math.round(b.expectedVoters));
    }

    if (b.round1) {
      if (Number.isFinite(b.round1.tokenBudget) && b.round1.tokenBudget >= 1) {
        c.round1.tokenBudget = Math.min(100000, Math.round(b.round1.tokenBudget));
      }
      if (Number.isFinite(b.round1.maxPicks) && b.round1.maxPicks >= 1) {
        c.round1.maxPicks = Math.min(30, Math.round(b.round1.maxPicks));
      }
      if (Number.isFinite(b.round1.scoreWeight) && b.round1.scoreWeight >= 0) {
        c.round1.scoreWeight = b.round1.scoreWeight;
      }
    }
    if (b.round2) {
      if (Array.isArray(b.round2.points)) {
        const p = b.round2.points.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
        if (p.length >= 1 && p.length <= 30) c.round2.points = p;
      }
      if (Number.isFinite(b.round2.scoreWeight) && b.round2.scoreWeight >= 0) {
        c.round2.scoreWeight = b.round2.scoreWeight;
      }
    }
  });
  res.json({ ok: true, config: store.getData().config });
});

app.put('/api/admin/candidates', requireAdmin, (req, res) => {
  const list = req.body?.candidates;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'candidates 배열이 필요합니다.' });

  const KINDS = new Set(['순수한글', '한자']);
  const TM = new Set(['미확인', '중복없음', '중복있음']);

  store.mutate((d) => {
    const byId = new Map(d.candidates.map((c) => [c.id, c]));
    for (const inp of list) {
      const c = byId.get(inp.id);
      if (!c) continue;
      if (typeof inp.name === 'string') c.name = inp.name.slice(0, 60);
      if (KINDS.has(inp.kind)) c.kind = inp.kind;
      if (typeof inp.english === 'string') c.english = inp.english.slice(0, 80);
      if (TM.has(inp.trademark)) c.trademark = inp.trademark;
      if (typeof inp.description === 'string') c.description = inp.description.slice(0, 4000);
      if (typeof inp.proposer === 'string') c.proposer = inp.proposer.slice(0, 40);
    }
  });
  res.json({ ok: true, candidates: store.getData().candidates });
});

// 후보(이름) 칸 수 조정 — 준비 단계 + 표 없음일 때만
app.put('/api/admin/candidate-count', requireAdmin, (req, res) => {
  const n = Math.round(Number(req.body?.count));
  if (!Number.isFinite(n) || n < 2 || n > 30) {
    return res.status(400).json({ error: '후보 수는 2~30 사이여야 합니다.' });
  }
  const d = store.getData();
  if (d.config.phase !== 'prep') {
    return res.status(409).json({ error: '준비 단계에서만 후보 수를 바꿀 수 있습니다.' });
  }
  if (d.ballots.round1.length || d.ballots.round2.length) {
    return res.status(409).json({ error: '투표가 시작된 뒤에는 후보 수를 바꿀 수 없습니다.' });
  }
  store.mutate((data) => {
    const cur = data.candidates.length;
    if (n > cur) {
      for (let i = cur; i < n; i++) data.candidates.push(store.makeCandidate(i));
    } else if (n < cur) {
      data.candidates = data.candidates.slice(0, n);
    }
    data.config.candidateCount = n;
  });
  res.json({ ok: true, candidateCount: n, candidates: store.getData().candidates });
});

const PHASES = ['prep', 'round1_open', 'round1_closed', 'round2_open', 'round2_closed', 'done'];
app.put('/api/admin/phase', requireAdmin, (req, res) => {
  const target = req.body?.phase;
  if (!PHASES.includes(target)) return res.status(400).json({ error: '알 수 없는 단계입니다.' });

  const d = store.getData();
  if (target === 'round1_open' || target === 'round2_open') {
    if (votableCandidates(d).length < 2) {
      return res.status(400).json({ error: '투표 가능한 이름(비어있음·상표 중복있음 제외)이 2개 이상 필요합니다.' });
    }
  }
  store.mutate((data) => {
    data.config.phase = target;
  });
  res.json({ ok: true, phase: target });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const what = req.body?.what;
  if (!['round1', 'round2', 'all'].includes(what)) {
    return res.status(400).json({ error: 'what 은 round1 | round2 | all 이어야 합니다.' });
  }
  store.mutate((d) => {
    if (what === 'round1' || what === 'all') d.ballots.round1 = [];
    if (what === 'round2' || what === 'all') d.ballots.round2 = [];
    if (what === 'all') d.config.phase = 'prep';
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* 정적 파일 + 페이지                                                   */
/* ------------------------------------------------------------------ */
app.use(express.static(join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));
app.get('/results', (req, res) => res.sendFile(join(__dirname, 'public', 'results.html')));

// JSON 파싱 오류 등
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  next();
});

app.listen(PORT, () => {
  console.log(`이름 공모전 투표 시스템 실행 중  ->  http://localhost:${PORT}`);
  console.log(`  투표    : /`);
  console.log(`  관리자  : /admin`);
  console.log(`  결과    : /results`);
});
