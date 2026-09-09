import { api, esc, won } from '/api.js';

const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout');
let token = localStorage.getItem('adminToken') || '';
let D = null; // 최신 관리자 데이터
let tab = 'settings';
let pollTimer = null;

const PHASES = [
  ['prep', '준비 중'],
  ['round1_open', '1차 투표 진행 중'],
  ['round1_closed', '1차 투표 마감'],
  ['round2_open', '2차 투표 진행 중'],
  ['round2_closed', '2차 투표 마감'],
  ['done', '최종 발표'],
];

logoutBtn.addEventListener('click', () => {
  token = '';
  localStorage.removeItem('adminToken');
  location.reload();
});

start();

async function start() {
  if (!token) return renderLogin();
  try {
    await refresh();
    logoutBtn.hidden = false;
  } catch (e) {
    if (e.status === 401) renderLogin();
    else app.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
  }
}

function authed(path, opts = {}) {
  return api(path, { ...opts, headers: { ...(opts.headers || {}), 'x-admin-token': token } });
}

async function refresh() {
  D = await authed('/api/admin/data');
  renderTab();
}

/* ------------------------------------------------------------------ */
/* 로그인                                                              */
/* ------------------------------------------------------------------ */
function renderLogin() {
  logoutBtn.hidden = true;
  app.innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>관리자 로그인</h2>
      <p class="hint">서버에 설정한 <code class="mono">ADMIN_PASSWORD</code> 를 입력하세요.</p>
      <label class="field"><span>비밀번호</span>
        <input type="password" id="pw" autocomplete="current-password" /></label>
      <div id="loginErr"></div>
      <button class="btn-primary btn-block" id="loginBtn">로그인</button>
    </div>`;
  const pw = document.getElementById('pw');
  const go = async () => {
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    document.getElementById('loginErr').innerHTML = '';
    try {
      const r = await api('/api/admin/login', { body: { password: pw.value } });
      token = r.token;
      localStorage.setItem('adminToken', token);
      start();
    } catch (e) {
      document.getElementById('loginErr').innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      btn.disabled = false;
    }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  document.getElementById('loginBtn').addEventListener('click', go);
  pw.focus();
}

/* ------------------------------------------------------------------ */
/* 탭 셸                                                               */
/* ------------------------------------------------------------------ */
function renderTab() {
  clearInterval(pollTimer);
  app.innerHTML = `
    <div class="tabs">
      ${[
        ['settings', '설정'],
        ['candidates', `후보 ${D.config.candidateCount}`],
        ['results', '결과 · 집계'],
      ]
        .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`)
        .join('')}
    </div>
    <div id="tabBody"></div>`;
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      renderTab();
    }),
  );
  const body = document.getElementById('tabBody');
  if (tab === 'settings') renderSettings(body);
  if (tab === 'candidates') renderCandidates(body);
  if (tab === 'results') {
    renderResults(body);
    pollTimer = setInterval(() => authed('/api/admin/data').then((d) => {
      D = d;
      if (tab === 'results') renderResults(document.getElementById('tabBody'));
    }).catch(() => {}), 10000);
  }
}

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `notice ${kind}`;
  t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9;box-shadow:var(--shadow)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ------------------------------------------------------------------ */
/* 설정 탭                                                             */
/* ------------------------------------------------------------------ */
function renderSettings(root) {
  const c = D.config;
  root.innerHTML = `
    <div class="card">
      <h2>단계 진행</h2>
      <p class="hint">현재: <b>${PHASES.find((p) => p[0] === c.phase)?.[1] || c.phase}</b> ·
        1차 ${D.ballotCounts.round1}표 / 2차 ${D.ballotCounts.round2}표.
        단계를 바꾸면 투표 페이지에 즉시 반영됩니다. (1차·2차 시작은 이름이 2개 이상 입력돼야 합니다)</p>
      <div class="phasebar">
        ${PHASES.map(([k, l]) => `<button data-phase="${k}" class="${c.phase === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <div id="phaseErr" class="mt"></div>
      <div class="grid-2 mt">
        <label class="field">
          <span>투표 인원 (번호 방식이면 1~이 수 · 도달 시 자동 마감 · 0 = 무제한)</span>
          <div class="btn-row">
            <input type="number" id="expected" value="${c.expectedVoters ?? 19}" min="0" max="100000" style="width:110px" />
            <button id="saveExpected">적용</button>
          </div>
        </label>
        <label class="field">
          <span>결과 페이지(/results) 공개</span>
          <select id="resPub">
            <option value="false" ${!c.resultsPublic ? 'selected' : ''}>비공개 (마감 후 자동 공개)</option>
            <option value="true" ${c.resultsPublic ? 'selected' : ''}>지금 공개</option>
          </select>
        </label>
      </div>
      <label class="field" style="max-width:420px">
        <span>투표 참여 방식</span>
        <select id="voterMode">
          <option value="number" ${c.useVoterNumbers ? 'selected' : ''}>본인 번호 입력 (1 ~ ${c.expectedVoters ?? 19})</option>
          <option value="open" ${!c.useVoterNumbers ? 'selected' : ''}>번호 없이 (링크만 · 브라우저 기준 중복 방지)</option>
        </select>
      </label>
      <p class="hint">
        <b>번호 방식</b>: 투표자가 배정받은 번호를 입력하고 시작. 번호당 1회만 가능하고 브라우저 데이터와 무관합니다.
        각자에게 1~${c.expectedVoters ?? 19}번을 나눠 주세요(사원 명단 순서 등). 아래 "결과·집계" 탭에서 투표한 번호를 볼 수 있습니다.<br />
        <b>번호 없이</b>: 링크만 열면 바로 투표. 같은 브라우저 재투표만 막습니다.
        어느 쪽이든 링크는 사내에만 공유하세요.
      </p>
    </div>

    <div class="card">
      <h2>공모전 정보</h2>
      <label class="field"><span>제목</span><input type="text" id="title" value="${esc(c.title)}" /></label>
      <label class="field"><span>부제</span><input type="text" id="subtitle" value="${esc(c.subtitle || '')}" /></label>
      <label class="field" style="max-width:260px"><span>상금 (원)</span>
        <input type="number" id="prize" value="${c.prize}" min="0" step="10000" /></label>
      <button class="btn-primary" id="saveInfo">정보 저장</button>
    </div>

    <div class="card">
      <h2>투표 방식 설정</h2>
      <label class="field" style="max-width:320px">
        <span>공모전에 올릴 이름(후보) 수 ${c.phase === 'prep' ? '' : '— 준비 단계에서만 변경 가능'}</span>
        <div class="btn-row">
          <input type="number" id="candCount" value="${c.candidateCount}" min="2" max="30"
                 ${c.phase === 'prep' ? '' : 'disabled'} style="width:90px" />
          <button id="saveCandCount" ${c.phase === 'prep' ? '' : 'disabled'}>후보 수 적용</button>
        </div>
      </label>
      <div class="grid-2">
        <label class="field"><span>1차 토큰(총점)</span>
          <input type="number" id="tb1" value="${c.round1.tokenBudget ?? 100}" min="1" step="10" /></label>
        <label class="field"><span>1차 최대 선택 이름 수</span>
          <input type="number" id="mp1" value="${c.round1.maxPicks ?? 5}" min="1" max="30" /></label>
      </div>
      <label class="field"><span>2차 순위별 점수 (쉼표 구분 · 개수 = 선택 가능 수)</span>
        <input type="text" id="p2" value="${c.round2.points.join(', ')}" /></label>
      <div class="grid-2">
        <label class="field"><span>종합 반영 비율 — 1차</span>
          <input type="number" id="sw1" value="${c.round1.scoreWeight ?? 1}" min="0" step="0.5" /></label>
        <label class="field"><span>종합 반영 비율 — 2차</span>
          <input type="number" id="sw2" value="${c.round2.scoreWeight ?? 1}" min="0" step="0.5" /></label>
      </div>
      <button class="btn-primary" id="saveVote">방식 저장</button>
      <p class="hint mt">
        1차·2차 모두 이름 전체를 대상으로 투표합니다.
        <b>1차</b>: 토큰 ${c.round1.tokenBudget ?? 100}점을 최대 ${c.round1.maxPicks ?? 5}개 이름에 0~${c.round1.tokenBudget ?? 100}점 자유 배분(합계 = 토큰).
        <b>2차</b>: 순위별 고정 점수.<br />
        <b>종합</b>: 각 라운드를 <b>100점 만점으로 환산</b>한 뒤 위 비율로 합산합니다.
        <b>1 : 1 이면 두 투표가 정확히 같은 무게</b>로 반영됩니다 (원점수 크기 차이는 자동 보정).
        2차를 더 중시하려면 예: 1차 1 / 2차 2.
      </p>
    </div>

    <div class="card" style="border-color:color-mix(in srgb,var(--danger) 40%,transparent)">
      <h2 style="color:var(--danger)">위험 구역</h2>
      <p class="hint">초기화하면 해당 라운드의 투표 기록이 모두 삭제됩니다. 되돌릴 수 없습니다.</p>
      <div class="btn-row">
        <button class="btn-danger" data-reset="round1">1차 투표 초기화</button>
        <button class="btn-danger" data-reset="round2">2차 투표 초기화</button>
        <button class="btn-danger" data-reset="all">전체 초기화</button>
      </div>
    </div>`;

  root.querySelectorAll('[data-phase]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await authed('/api/admin/phase', { method: 'PUT', body: { phase: b.dataset.phase } });
        await refresh();
        toast('단계를 변경했습니다.');
      } catch (e) {
        document.getElementById('phaseErr').innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      }
    }),
  );

  document.getElementById('resPub').addEventListener('change', async (e) => {
    await authed('/api/admin/config', { method: 'PUT', body: { resultsPublic: e.target.value === 'true' } });
    toast('결과 공개 설정을 저장했습니다.');
  });

  document.getElementById('saveExpected').addEventListener('click', async () => {
    await authed('/api/admin/config', {
      method: 'PUT',
      body: { expectedVoters: Number(document.getElementById('expected').value) },
    });
    await refresh();
    toast('투표 인원을 저장했습니다.');
  });

  document.getElementById('voterMode').addEventListener('change', async (e) => {
    await authed('/api/admin/config', {
      method: 'PUT',
      body: { useVoterNumbers: e.target.value === 'number' },
    });
    await refresh();
    toast('투표 참여 방식을 저장했습니다.');
  });

  document.getElementById('saveInfo').addEventListener('click', async () => {
    await authed('/api/admin/config', {
      method: 'PUT',
      body: {
        title: document.getElementById('title').value,
        subtitle: document.getElementById('subtitle').value,
        prize: Number(document.getElementById('prize').value),
      },
    });
    await refresh();
    toast('저장했습니다.');
  });

  document.getElementById('saveCandCount').addEventListener('click', async () => {
    try {
      await authed('/api/admin/candidate-count', {
        method: 'PUT',
        body: { count: Number(document.getElementById('candCount').value) },
      });
      await refresh();
      toast('후보 수를 변경했습니다.');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  document.getElementById('saveVote').addEventListener('click', async () => {
    const tb = Number(document.getElementById('tb1').value);
    const mp = Number(document.getElementById('mp1').value);
    const p = parseNums(document.getElementById('p2').value);
    if (!(tb >= 1) || !(mp >= 1) || !p.length) return toast('값을 확인하세요.', 'err');
    await authed('/api/admin/config', {
      method: 'PUT',
      body: {
        round1: { tokenBudget: tb, maxPicks: mp, scoreWeight: Number(document.getElementById('sw1').value) },
        round2: { points: p, scoreWeight: Number(document.getElementById('sw2').value) },
      },
    });
    await refresh();
    toast('투표 방식을 저장했습니다.');
  });

  root.querySelectorAll('[data-reset]').forEach((b) =>
    b.addEventListener('click', async () => {
      const what = b.dataset.reset;
      if (!confirm(`정말 "${what}" 를 초기화할까요? 되돌릴 수 없습니다.`)) return;
      if (!confirm('한 번 더 확인합니다. 초기화를 진행합니다.')) return;
      await authed('/api/admin/reset', { body: { what } });
      await refresh();
      toast('초기화했습니다.');
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 후보 탭                                                             */
/* ------------------------------------------------------------------ */
function renderCandidates(root) {
  const KINDS = ['순수한글', '한자'];
  const TM = ['미확인', '중복없음', '중복있음'];
  root.innerHTML = `
    <div class="card">
      <h2>후보 이름 ${D.candidates.length}개</h2>
      <p class="hint">
        조건 — ① 순수한글 또는 한자 기반 이름 ② (순수한글의 경우) 영문 표기가 예쁠 것
        ③ 상표 검색 시 소프트웨어 분야 중복이 없을 것.<br />
        <b>설명 칸</b>에 "이 이름이 어떤 시스템/의미인지"를 대표님이 직접 채워 주세요. 여기서 저장하면 투표 페이지에 바로 반영됩니다. 이름이 비면 투표 후보에서 제외됩니다.<br />
        칸 개수는 <b>설정 → 투표 방식 설정</b>에서 조정할 수 있습니다(준비 단계에서만).
      </p>
      <div id="cands"></div>
      <button class="btn-primary btn-lg" id="saveCands">후보 전체 저장</button>
    </div>`;

  document.getElementById('cands').innerHTML = D.candidates
    .map(
      (c, i) => `
    <div class="adm-cand" data-id="${c.id}">
      <div class="row1">
        <div class="idx">${i + 1}</div>
        <input type="text" data-f="name" placeholder="이름" value="${esc(c.name)}" />
        <select data-f="kind">${KINDS.map((k) => `<option ${c.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <input type="text" data-f="english" placeholder="영문 표기" value="${esc(c.english)}" />
      </div>
      <div class="row2">
        <input type="text" data-f="proposer" placeholder="제안자 (선택)" value="${esc(c.proposer)}" />
        <select data-f="trademark">${TM.map((k) => `<option ${c.trademark === k ? 'selected' : ''}>상표: ${k}</option>`).join('')}</select>
      </div>
      <textarea data-f="description" placeholder="설명 — 어떤 시스템/의미인지 (투표 화면에 표시됩니다)">${esc(c.description)}</textarea>
    </div>`,
    )
    .join('');

  // select 옵션 텍스트에 "상표: " 프리픽스를 넣었으니 저장 시 정리
  document.getElementById('saveCands').addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('.adm-cand')].map((el) => {
      const get = (f) => el.querySelector(`[data-f="${f}"]`).value;
      return {
        id: el.dataset.id,
        name: get('name').trim(),
        kind: get('kind'),
        english: get('english').trim(),
        trademark: get('trademark').replace('상표: ', ''),
        proposer: get('proposer').trim(),
        description: get('description'),
      };
    });
    await authed('/api/admin/candidates', { method: 'PUT', body: { candidates: rows } });
    await refresh();
    toast('후보를 저장했습니다.');
  });
}

/* ------------------------------------------------------------------ */
/* 결과 탭                                                             */
/* ------------------------------------------------------------------ */
function scoreTable(section, extraHead = '', extraCell = () => '') {
  const scheme =
    section.tokenBudget != null
      ? `토큰 ${section.tokenBudget}점 / 최대 ${section.maxPicks}개`
      : (section.points || []).join(' · ') + '점';
  return `
    <div class="grid-2">
      <div class="stat"><div class="k">투표 수</div><div class="v">${section.totalBallots}${
        section.expectedVoters ? ` / ${section.expectedVoters}` : ''
      }</div></div>
      <div class="stat"><div class="k">방식</div><div class="v" style="font-size:1rem">${scheme}</div></div>
    </div>
    <div class="table-scroll mt">
      <table class="data"><thead><tr><th>순위</th><th>이름</th><th>영문</th>${extraHead}<th class="num">점수</th><th class="num">${
        section.tokenBudget != null ? '최고배점' : '1순위표'
      }</th></tr></thead>
      <tbody>${section.rows
        .map(
          (x) => `<tr class="${x.rank === 1 ? 'top1' : ''}"><td class="num">${x.rank}</td><td>${esc(x.name)}</td>
          <td class="muted">${esc(x.english || '')}</td>${extraCell(x)}<td class="num">${d1(x.score)}</td><td class="num">${x.firsts}</td></tr>`,
        )
        .join('')}</tbody></table>
    </div>`;
}

function renderResults(root) {
  const r = D.results;
  const cr = r.combineRatio || { round1: 1, round2: 1 };
  const ratioTxt = cr.round1 === cr.round2 ? '1 : 1 (동일 무게)' : `1차 ${cr.round1} : 2차 ${cr.round2}`;

  root.innerHTML = `
    <div class="card">
      <h2>종합 집계 (1차 + 2차)</h2>
      <p class="hint">각 라운드를 100점 만점으로 환산 후 <b>${ratioTxt}</b> 비율로 합산. 비율은 <b>설정</b> 탭에서 조정합니다. (아래 열은 환산값)</p>
      ${
        r.winner && r.combined.some((x) => x.score > 0)
          ? `<div class="prize mt">🏆 <span>현재 1위: <b>${esc(r.winner.name)}</b>${
              r.winner.english ? ` (${esc(r.winner.english)})` : ''
            } — 종합 ${d1(r.winner.score)}점 · 상금 ${won(r.prize)} 대상</span></div>`
          : '<p class="hint">아직 집계된 표가 없습니다.</p>'
      }
      <div class="table-scroll mt">
        <table class="data"><thead><tr><th>순위</th><th>이름</th><th>영문</th>
          <th class="num">1차(환산)</th><th class="num">2차(환산)</th><th class="num">종합</th></tr></thead>
        <tbody>${r.combined
          .map(
            (x) => `<tr class="${x.rank === 1 ? 'top1' : ''}"><td class="num">${x.rank}</td>
            <td>${esc(x.name)}</td><td class="muted">${esc(x.english || '')}</td>
            <td class="num">${d1(x.round1Score)}</td><td class="num">${d1(x.round2Score)}</td>
            <td class="num"><b>${d1(x.score)}</b></td></tr>`,
          )
          .join('')}</tbody></table>
      </div>
    </div>

    ${D.config.useVoterNumbers && D.config.expectedVoters >= 1 ? voterNumberCard() : ''}

    <div class="card"><h2>1차 집계</h2>${scoreTable(r.round1)}</div>
    <div class="card"><h2>2차 집계</h2>${scoreTable(r.round2)}</div>
    <p class="muted" style="font-size:.82rem">10초마다 자동 갱신됩니다.</p>`;
}

function voterNumberCard() {
  const max = D.config.expectedVoters;
  const vn = D.votedNumbers || { round1: [], round2: [] };
  const line = (label, arr) => {
    const set = new Set(arr);
    const notYet = [];
    for (let i = 1; i <= max; i++) if (!set.has(i)) notYet.push(i);
    return `<p style="margin:.3em 0"><b>${label}</b> — 완료 ${arr.length}/${max}명 ·
      <span class="muted">미투표: ${notYet.length ? notYet.join(', ') : '없음 ✓'}</span></p>`;
  };
  return `<div class="card">
    <h2>투표 현황 (번호별)</h2>
    ${line('1차', vn.round1)}
    ${line('2차', vn.round2)}
    <p class="hint">미투표 번호에게 리마인드하세요. (집계 화면에는 번호별 선택 내용을 표시하지 않습니다.)</p>
  </div>`;
}

const d1 = (n) => Math.round(Number(n || 0) * 10) / 10;

/* ------------------------------------------------------------------ */
function parseNums(s) {
  return String(s || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}
