// 투표 데이터 영구 저장소 — 외부 DB 없이 JSON 파일 하나로 관리한다.
// 모든 읽기는 메모리에서, 쓰기는 큐에 직렬화한 뒤 임시파일→rename 으로 원자적 저장.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.json');

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
      // 1차·2차 모두 같은 후보 전체를 대상으로 투표하고, 최종 순위는 두 라운드 점수를 합산해서 낸다.
      round1: { weights: [60, 30, 10, 0], scoreWeight: 1 }, // 순위별 배점 + 종합 반영 배율
      round2: { points: [5, 4, 3, 2, 1], scoreWeight: 1 }, // 순위별 점수 + 종합 반영 배율
    },
    candidates: makeCandidates(DEFAULT_CANDIDATE_COUNT),
    codes: { round1: [], round2: [] }, // { code, used, usedAt }
    ballots: { round1: [], round2: [] }, // { code, ranking:[id...], at }
    meta: { createdAt: now, updatedAt: now },
  };
}

let data = null;
let writeChain = Promise.resolve();

export async function init() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DB_PATH)) {
    data = migrate(JSON.parse(await readFile(DB_PATH, 'utf8')));
  } else {
    data = defaultData();
    await flush();
  }
  return data;
}

export function getData() {
  return data;
}

// fn(data) 안에서 메모리 상태를 동기적으로 바꾸고, 저장은 큐에 넘긴다.
export function mutate(fn) {
  const result = fn(data);
  data.meta.updatedAt = new Date().toISOString();
  writeChain = writeChain.then(flush).catch((err) => console.error('[store] 저장 실패:', err));
  return result;
}

async function flush() {
  const tmp = `${DB_PATH}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, DB_PATH);
}

// 이전 버전 파일도 최신 스키마 형태를 보장한다.
function migrate(d) {
  const def = defaultData();
  d.config = { ...def.config, ...(d.config || {}) };
  d.config.round1 = { ...def.config.round1, ...(d.config.round1 || {}) };
  d.config.round2 = { ...def.config.round2, ...(d.config.round2 || {}) };
  delete d.config.finalists; // 구버전 잔재 제거 (1·2차 종합 방식으로 변경)
  delete d.config.round2.advanceCount;
  d.codes = { round1: [], round2: [], ...(d.codes || {}) };
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
