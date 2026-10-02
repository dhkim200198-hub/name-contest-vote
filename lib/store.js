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

// 5개 항목(카테고리) — 이름 제안·투표·집계가 서로 완전히 독립적으로 진행된다.
export const CATEGORY_SEEDS = [
  {
    id: 'service-os',
    name: '제조업(자동차부품) 서비스 단 OS',
    examples: ['Warp Speed OS', 'SHIP OS', 'ArsenalOS'],
    description:
      '고객사 제조 현장(자동차부품 등)에 배포되어 실제로 돌아가는 서비스 단 OS입니다. ' +
      '다른 회사의 비슷한 제품으로 Warp Speed OS, SHIP OS, ArsenalOS 같은 이름들이 있습니다.',
    prize: 500000,
  },
  {
    id: 'ontology',
    name: '온톨로지 계층',
    examples: ['Foundry'],
    description:
      '데이터를 온톨로지로 모델링하고 다루는 계층으로, 에디터 등을 포함합니다. ' +
      '다른 회사의 비슷한 제품으로 Foundry가 있습니다.',
    prize: 500000,
  },
  {
    id: 'aip',
    name: '데이터·AI·워크플로 서비스',
    examples: ['AIP'],
    description:
      '온톨로지 계층 위에서 동작하는 각종 데이터, AI, 워크플로 서비스입니다. ' +
      '다른 회사의 비슷한 제품으로 AIP가 있습니다.',
    prize: 500000,
  },
  {
    id: 'ops',
    name: '배포 버전 관리 Ops',
    examples: ['Apollo'],
    description:
      '고객사별·사이트별 등으로 배포된 서비스의 버전을 관리하는 Ops입니다. ' +
      '다른 회사의 비슷한 제품으로 Apollo가 있습니다.',
    prize: 500000,
  },
  {
    id: 'meeting-room',
    name: '회의실 (대회의실·소회의실)',
    examples: [],
    description:
      '사무실 대회의실과 소회의실의 이름입니다. 두 회의실 이름을 한 세트로 제안하고, ' +
      '투표도 세트 단위로 진행해 1위 세트를 선정합니다.',
    prize: 200000,
    // 이 항목은 이름을 세트로 받는다: name/english 가 "대회의실 이름 / 소회의실 이름" 형태로 저장됨
    pairLabels: ['대회의실', '소회의실'],
    // 자유 작명: 순수한글/한자 제한·상표 확인 없음, 영문 표기는 선택
    freeNaming: true,
    // 제안 화면에 띄우는 항목 전용 공지 (한 줄 = 한 문단)
    notice: [
      '회의실 이름은 순수한글·한자일 필요가 없습니다. 영어·외래어 등 자유롭게 제안하세요. 영문 표기는 선택입니다.',
      '단, 짜치는 이름은 금지입니다. 아재개그·말장난, 유행어·밈, 오글거리는 이름, "회의실1/2"·"A룸/B룸"처럼 대충 지은 이름, 특정인 이름이나 우리끼리만 아는 사내 농담은 피해 주세요.',
      '매일 쓰고 손님도 드나드는 공간입니다. 외부 사람이 들어도 자연스럽고, 오래 불러도 질리지 않는 이름이면 좋습니다.',
    ],
  },
];

// 세트형 항목의 name/english 구분자
export const PAIR_SEP = ' / ';

export function makeCandidate({ name = '', kind = '순수한글', english = '', description = '', proposer = null } = {}) {
  return {
    id: randomUUID(),
    name,
    kind, // '순수한글' | '한자'
    english, // 영문 표기
    description, // 한두 줄 설명
    proposer, // 제안한 사람의 번호 (본인 번호 방식)
    hidden: false, // 관리자가 스팸/중복 등으로 투표 대상에서 숨김 처리
    createdAt: new Date().toISOString(),
  };
}

function makeCategory(seed, i) {
  return {
    id: seed.id,
    order: i + 1,
    name: seed.name,
    description: seed.description,
    examples: seed.examples,
    prize: seed.prize, // 이 항목 최종 선정 이름에 수여되는 상금(원)
    pairLabels: seed.pairLabels || null,
    freeNaming: !!seed.freeNaming,
    notice: seed.notice || null,
    phase: 'prep', // prep | round1_open | round1_closed | round2_open | round2_closed | done
    resultsPublic: false,
    // 1차: 토큰(총 tokenBudget점)을 최대 maxPicks개 이름에 0~tokenBudget 자유 배분 (합계 = tokenBudget)
    round1: { tokenBudget: 100, maxPicks: 5, scoreWeight: 1 },
    // 2차: 순위별 고정 점수 (보르다)
    round2: { points: [5, 4, 3, 2, 1], scoreWeight: 1 },
    candidates: [], // 준비 단계에 직원들이 직접 제안해서 채워짐
    // round1 표: { voterKey, allocations:[{id,points}], at }  /  round2 표: { voterKey, ranking:[id...], at }
    ballots: { round1: [], round2: [] },
  };
}

function makeCategories() {
  return CATEGORY_SEEDS.map(makeCategory);
}

function defaultData() {
  const now = new Date().toISOString();
  return {
    config: {
      title: '사내 이름 공모전',
      subtitle: '우리가 함께 쓸 이름을 함께 정합니다',
      expectedVoters: 19, // 투표/제안 인원. 번호 방식이면 1~이 값 범위. 도달 시 자동 마감 (0 = 무제한)
      useVoterNumbers: true, // true: 투표자가 본인 번호(1~expectedVoters) 입력 / false: 번호 없이 링크만(브라우저 기준 중복 방지)
      maxProposalsPerCategory: 2, // 1인당 항목당 최대 제안 가능 개수
    },
    categories: makeCategories(),
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

export function getCategory(id) {
  return data.categories.find((c) => c.id === id) || null;
}

// fn(data) 안에서 메모리 상태를 동기적으로 바꾸고, 저장은 큐에 직렬화한다.
export function mutate(fn) {
  const result = fn(data);
  data.meta.updatedAt = new Date().toISOString();
  writeChain = writeChain.then(persist).catch((err) => console.error('[store] 저장 실패:', err));
  return result;
}

// 이전 버전 파일도 최신 스키마 형태를 보장한다.
// 구버전(단일 카테고리, 후보 슬롯 고정) 데이터는 보존할 내용이 없어 새 스키마로 교체한다.
function migrate(d) {
  const def = defaultData();
  if (!Array.isArray(d.categories)) {
    return def;
  }
  d.config = { ...def.config, ...(d.config || {}) };
  delete d.config.prize; // 상금은 항목별(category.prize)로 이동
  if (!Number.isFinite(d.config.expectedVoters)) d.config.expectedVoters = 19;
  if (typeof d.config.useVoterNumbers !== 'boolean') d.config.useVoterNumbers = true;
  if (!Number.isFinite(d.config.maxProposalsPerCategory) || d.config.maxProposalsPerCategory < 1) {
    d.config.maxProposalsPerCategory = 2;
  }

  const byId = new Map(d.categories.map((c) => [c.id, c]));
  d.categories = CATEGORY_SEEDS.map((seed, i) => {
    const base = makeCategory(seed, i);
    const saved = byId.get(seed.id);
    if (!saved) return base;
    const cat = { ...base, ...saved, examples: base.examples, order: base.order, pairLabels: base.pairLabels, freeNaming: base.freeNaming, notice: base.notice };
    if (!Number.isFinite(saved.prize)) cat.prize = base.prize;
    cat.round1 = { ...base.round1, ...(saved.round1 || {}) };
    cat.round2 = { ...base.round2, ...(saved.round2 || {}) };
    cat.ballots = { round1: [], round2: [], ...(saved.ballots || {}) };
    cat.candidates = Array.isArray(saved.candidates)
      ? saved.candidates.map((c) => ({ ...makeCandidate(), ...c }))
      : [];
    return cat;
  });

  d.meta = { ...def.meta, ...(d.meta || {}) };
  return d;
}
