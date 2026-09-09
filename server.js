import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as store from './lib/store.js';
import { tallyRound1, tallyRound2 } from './lib/tally.js';
import { makeCodes } from './lib/codes.js';

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
  return d.candidates.filter((c) => c.name && c.name.trim()).sort((a, b) => a.order - b.order);
}
function publicCandidate(c) {
  return { id: c.id, name: c.name, kind: c.kind, english: c.english, description: c.description };
}
function roundOf(phase) {
  if (phase === 'round1_open') return 1;
  if (phase === 'round2_open') return 2;
  return null;
}
function codeList(d, round) {
  return round === 1 ? d.codes.round1 : d.codes.round2;
}
function ballotList(d, round) {
  return round === 1 ? d.ballots.round1 : d.ballots.round2;
}
function findCode(d, round, raw) {
  const code = String(raw || '').toUpperCase().trim();
  return codeList(d, round).find((x) => x.code === code);
}
function validateRanking(ranking, allowedIds, maxLen) {
  if (!Array.isArray(ranking) || ranking.length === 0) return '선택된 후보가 없습니다.';
  if (ranking.some((x) => typeof x !== 'string')) return '잘못된 요청입니다.';
  if (ranking.length > maxLen) return `최대 ${maxLen}명까지 선택할 수 있습니다.`;
  if (new Set(ranking).size !== ranking.length) return '같은 후보를 중복해서 선택했습니다.';
  const allow = new Set(allowedIds);
  if (ranking.some((id) => !allow.has(id))) return '선택할 수 없는 후보가 포함되어 있습니다.';
  return null;
}
function round2Ballot(d) {
  // 2차도 1차와 동일하게 후보 전체를 대상으로 다시 순위를 매긴다.
  const candidates = votableCandidates(d).map(publicCandidate);
  const maxPick = Math.min(d.config.round2.points.length, candidates.length);
  return { candidates, maxPick };
}

function buildResults(d) {
  const cfg = d.config;
  const cand = (id) => d.candidates.find((c) => c.id === id) || {};
  const label = (x) => ({ ...x, name: cand(x.id).name || x.id, english: cand(x.id).english || '' });
  const votableIds = votableCandidates(d).map((c) => c.id);

  const w1 = Number(cfg.round1.scoreWeight) || 1;
  const w2 = Number(cfg.round2.scoreWeight) || 1;
  const r1 = tallyRound1(d.ballots.round1, cfg.round1.weights, votableIds);
  const r2 = tallyRound2(d.ballots.round2, cfg.round2.points, votableIds);

  const s1 = Object.fromEntries(r1.rows.map((x) => [x.id, x]));
  const s2 = Object.fromEntries(r2.rows.map((x) => [x.id, x]));
  let combined = votableIds.map((id) => {
    const a = s1[id] || { score: 0, firsts: 0 };
    const b = s2[id] || { score: 0, firsts: 0 };
    return {
      id,
      round1Score: a.score,
      round2Score: b.score,
      score: a.score * w1 + b.score * w2,
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

  return {
    phase: cfg.phase,
    title: cfg.title,
    subtitle: cfg.subtitle,
    prize: cfg.prize,
    scoreWeights: { round1: w1, round2: w2 },
    round1: {
      weights: cfg.round1.weights,
      totalBallots: r1.totalBallots,
      codeCount: d.codes.round1.length,
      usedCodes: d.codes.round1.filter((c) => c.used).length,
      rows: r1.rows.map(label),
    },
    round2: {
      points: cfg.round2.points,
      totalBallots: r2.totalBallots,
      codeCount: d.codes.round2.length,
      usedCodes: d.codes.round2.filter((c) => c.used).length,
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
  const out = {
    title: cfg.title,
    subtitle: cfg.subtitle,
    prize: cfg.prize,
    phase: cfg.phase,
    resultsPublic: cfg.resultsPublic,
    round1: { weights: cfg.round1.weights },
    round2: { points: cfg.round2.points },
    activeRound: roundOf(cfg.phase),
  };
  res.json(out);
});

app.post('/api/vote/check', (req, res) => {
  const d = store.getData();
  const round = roundOf(d.config.phase);
  if (!round) return res.status(409).json({ error: '지금은 진행 중인 투표가 없습니다.' });

  const raw = req.body?.code;
  if (!String(raw || '').trim()) return res.status(400).json({ error: '투표 코드를 입력하세요.' });

  const rec = findCode(d, round, raw);
  if (!rec) return res.status(404).json({ error: '존재하지 않는 코드입니다. 다시 확인해 주세요.' });
  if (rec.used) return res.status(409).json({ error: '이미 사용된 코드입니다.' });

  if (round === 1) {
    return res.json({
      ok: true,
      round: 1,
      title: d.config.title,
      prize: d.config.prize,
      candidates: votableCandidates(d).map(publicCandidate),
      maxPick: d.config.round1.weights.length,
      weights: d.config.round1.weights,
    });
  }
  const { candidates, maxPick } = round2Ballot(d);
  return res.json({
    ok: true,
    round: 2,
    title: d.config.title,
    prize: d.config.prize,
    candidates,
    maxPick,
    points: d.config.round2.points,
  });
});

app.post('/api/vote/submit', (req, res) => {
  const d = store.getData();
  const round = roundOf(d.config.phase);
  if (!round) return res.status(409).json({ error: '지금은 진행 중인 투표가 없습니다.' });

  const raw = req.body?.code;
  const ranking = req.body?.ranking;
  const rec = findCode(d, round, raw);
  if (!rec) return res.status(404).json({ error: '존재하지 않는 코드입니다.' });
  if (rec.used) return res.status(409).json({ error: '이미 사용된 코드입니다.' });

  let allowedIds;
  let maxPick;
  if (round === 1) {
    allowedIds = votableCandidates(d).map((c) => c.id);
    maxPick = d.config.round1.weights.length;
  } else {
    allowedIds = votableCandidates(d).map((c) => c.id);
    maxPick = Math.min(d.config.round2.points.length, allowedIds.length);
  }
  const err = validateRanking(ranking, allowedIds, maxPick);
  if (err) return res.status(400).json({ error: err });

  store.mutate((data) => {
    const r = findCode(data, round, raw);
    if (!r || r.used) return; // 동시 요청 방어
    r.used = true;
    r.usedAt = new Date().toISOString();
    ballotList(data, round).push({ code: r.code, ranking, at: r.usedAt });
  });

  res.json({ ok: true });
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
  res.json({
    config: d.config,
    candidates: d.candidates,
    codes: d.codes,
    ballotCounts: { round1: d.ballots.round1.length, round2: d.ballots.round2.length },
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

    if (b.round1) {
      if (Array.isArray(b.round1.weights)) {
        const w = b.round1.weights.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
        if (w.length >= 1 && w.length <= 30) c.round1.weights = w;
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

// 후보(이름) 칸 수 조정 — 준비 단계 + 표/결선 없음일 때만
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

app.post('/api/admin/codes', requireAdmin, (req, res) => {
  const round = Number(req.body?.round);
  const count = Math.min(200, Math.max(1, Number(req.body?.count) || 19));
  if (round !== 1 && round !== 2) return res.status(400).json({ error: 'round 는 1 또는 2 여야 합니다.' });

  const d = store.getData();
  if (ballotList(d, round).length > 0) {
    return res.status(409).json({
      error: `${round}차 투표에 이미 표가 있어 코드를 다시 만들 수 없습니다. "위험 구역"에서 ${round}차를 먼저 초기화하세요.`,
    });
  }
  const existing = new Set([...d.codes.round1, ...d.codes.round2].map((c) => c.code));
  const fresh = makeCodes(count, existing).map((code) => ({ code, used: false, usedAt: null }));
  store.mutate((data) => {
    if (round === 1) data.codes.round1 = fresh;
    else data.codes.round2 = fresh;
  });
  res.json({ ok: true, round, codes: fresh });
});

const PHASES = ['prep', 'round1_open', 'round1_closed', 'round2_open', 'round2_closed', 'done'];
app.put('/api/admin/phase', requireAdmin, (req, res) => {
  const target = req.body?.phase;
  if (!PHASES.includes(target)) return res.status(400).json({ error: '알 수 없는 단계입니다.' });

  const d = store.getData();
  if (target === 'round1_open') {
    if (d.codes.round1.length === 0) return res.status(400).json({ error: '먼저 1차 투표 코드를 생성하세요.' });
    if (votableCandidates(d).length < 2) return res.status(400).json({ error: '이름이 입력된 후보가 2개 이상 필요합니다.' });
  }
  if (target === 'round2_open') {
    if (votableCandidates(d).length < 2) return res.status(400).json({ error: '이름이 입력된 후보가 2개 이상 필요합니다.' });
    if (d.codes.round2.length === 0) return res.status(400).json({ error: '먼저 2차 투표 코드를 생성하세요.' });
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
    if (what === 'round1' || what === 'all') {
      d.ballots.round1 = [];
      d.codes.round1.forEach((c) => {
        c.used = false;
        c.usedAt = null;
      });
    }
    if (what === 'round2' || what === 'all') {
      d.ballots.round2 = [];
      d.codes.round2.forEach((c) => {
        c.used = false;
        c.usedAt = null;
      });
    }
    if (what === 'all') {
      d.config.phase = 'prep';
    }
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
