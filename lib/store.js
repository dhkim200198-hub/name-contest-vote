// 투표 데이터 영구 저장소.
// - 기본: 로컬 JSON 파일 (data/db.json)  ← 로컬 실행/테스트
// - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN 이 있으면 Upstash Redis 에 저장
//   (Render 무료 플랜처럼 파일이 유지되지 않는 환경에서 투표 기록을 보존하기 위함)
// 어느 쪽이든 "메모리의 data 객체가 작업본, 저장은 전체를 통째로 직렬화" 방식은 동일하다.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.json');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = process.env.UPSTASH_REDIS_KEY || 'name-contest-vote:db';
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

// 기본 후보(이름) 칸 수. 공모전에 올릴 이름은 4개 — 준비 단계에서 관리자가 조정 가능.
const DEFAULT_CANDIDATE_COUNT = 4;

export function makeCandidate(i) {
  return {
    id: `c${i + 1}`,
    order: i + 1,
    name: '',
    kind: '순수한글', // '순수한글' | '한자'
    english: '', // 영문 표기
    trademark: '미확인', // '미확인' | '중복없음' | '중복있음'
    description: '', // 대표님이 채우는 "어떤 시스템/의미인지" 설명 칸
    proposer: '', // 제안자 (선택)
  };
}

function makeCandidates(count) {
  return Array.from({ length: count }, (_, i) => makeCandidate(i));
}

function defaultData() {
  const now = new Date().toISOString();
  return {
    config: {
      title: '사내 이름 공모전',
      subtitle: '우리가 함께 쓸 이름을 함께 정합니다',
      prize: 1000000,
      phase: 'prep', // prep | round1_open | round1_closed | round2_open | round2_closed | done
      resultsPublic: false,
      candidateCount: DEFAULT_CANDIDATE_COUNT,
      expectedVoters: 19, // 이 인원에 도달하면 해당 라운드 자동 마감 (0 = 무제한)
      // 1차: 토큰(총 tokenBudget점)을 최대 maxPicks개 이름에 0~tokenBudget 자유 배분 (합계 = tokenBudget)
      round1: { tokenBudget: 100, maxPicks: 5, scoreWeight: 1 },
      // 2차: 순위별 고정 점수 (보르다)
      round2: { points: [5, 4, 3, 2, 1], scoreWeight: 1 },
    },
    candidates: makeCandidates(DEFAULT_CANDIDATE_COUNT),
    // round1 표: { voterKey, allocations:[{id,points}], at }  /  round2 표: { voterKey, ranking:[id...], at }
    ballots: { round1: [], round2: [] },
    meta: { createdAt: now, updatedAt: now },
  };
}

let data = null;
let writeChain = Promise.resolve();

/* ---------------- Upstash Redis REST ---------------- */
async function redisCmd(cmd) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()).result;
}

/* ---------------- 로드 / 저장 ---------------- */
async function loadRaw() {
  if (useRedis) {
    const v = await redisCmd(['GET', REDIS_KEY]);
    return v ? JSON.parse(v) : null;
  }
  if (existsSync(DB_PATH)) return JSON.parse(await readFile(DB_PATH, 'utf8'));
  return null;
}

async function persist(attempt = 0) {
  try {
    if (useRedis) {
      await redisCmd(['SET', REDIS_KEY, JSON.stringify(data)]);
    } else {
      const tmp = `${DB_PATH}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await rename(tmp, DB_PATH);
    }
  } catch (err) {
    if (useRedis && attempt < 3) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      return persist(attempt + 1);
    }
    throw err;
  }
}

export async function init() {
  if (!useRedis && !existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const raw = await loadRaw();
  if (raw) {
    data = migrate(raw);
  } else {
    data = defaultData();
    await persist();
  }
  console.log(`[store] 저장소: ${useRedis ? `Upstash Redis (key: ${REDIS_KEY})` : DB_PATH}`);
  return data;
}

export function getData() {
  return data;
}

// fn(data) 안에서 메모리 상태를 동기적으로 바꾸고, 저장은 큐에 직렬화한다.
export function mutate(fn) {
  const result = fn(data);
  data.meta.updatedAt = new Date().toISOString();
  writeChain = writeChain.then(persist).catch((err) => console.error('[store] 저장 실패:', err));
  return result;
}

// 이전 버전 파일도 최신 스키마 형태를 보장한다.
function migrate(d) {
  const def = defaultData();
  d.config = { ...def.config, ...(d.config || {}) };
  d.config.round1 = { ...def.config.round1, ...(d.config.round1 || {}) };
  d.config.round2 = { ...def.config.round2, ...(d.config.round2 || {}) };
  // 구버전(순위별 고정 가중치) → 자유 배분 방식으로 변환
  if (Array.isArray(d.config.round1.weights)) {
    const w = d.config.round1.weights;
    if (!Number.isFinite(d.config.round1.tokenBudget)) {
      d.config.round1.tokenBudget = w.reduce((a, b) => a + (Number(b) || 0), 0) || 100;
    }
    if (!Number.isFinite(d.config.round1.maxPicks)) d.config.round1.maxPicks = w.length || 5;
    delete d.config.round1.weights;
    d.ballots = { round1: [], round2: [], ...(d.ballots || {}) };
    d.ballots.round1 = []; // 과거 순위형 표는 새 방식과 호환 불가 → 비움
  }
  delete d.config.finalists; // 구버전 잔재 (1·2차 종합 방식으로 변경)
  delete d.config.round2.advanceCount;
  delete d.codes; // 코드 방식 폐기 (구글폼식 링크 투표로 전환)
  if (!Number.isFinite(d.config.expectedVoters)) d.config.expectedVoters = 19;
  d.ballots = { round1: [], round2: [], ...(d.ballots || {}) };
  if (!Array.isArray(d.candidates) || d.candidates.length === 0) {
    d.candidates = makeCandidates(d.config.candidateCount);
  } else {
    d.candidates = d.candidates.map((c, i) => ({ ...makeCandidate(i), ...c }));
  }
  if (!Number.isFinite(d.config.candidateCount)) d.config.candidateCount = d.candidates.length;
  d.meta = { ...def.meta, ...(d.meta || {}) };
  return d;
}
