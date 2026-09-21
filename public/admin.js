import { api, esc, won } from '/api.js';

const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout');
let token = localStorage.getItem('adminToken') || '';
let D = null; // 최신 관리자 데이터 { config, categories }
let tab = 'global';
let pollTimer = null;

const PHASES = [
  ['prep', '준비 중'],
  ['round1_open', '1차 투표 진행 중'],
  ['round1_closed', '1차 투표 마감'],
  ['round2_open', '2차 투표 진행 중'],
  ['round2_closed', '2차 투표 마감'],
  ['done', '최종 발표'],
];
const KINDS = ['순수한글', '한자'];

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
      <button data-tab="global" class="${tab === 'global' ? 'active' : ''}">전체 설정</button>
      ${D.categories
        .map((c) => `<button data-tab="${c.id}" class="${tab === c.id ? 'active' : ''}">${esc(c.name)}</button>`)
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
  if (tab === 'global') {
    renderGlobal(body);
    return;
  }
  const cat = D.categories.find((c) => c.id === tab);
  if (!cat) {
    tab = 'global';
    return renderTab();
  }
  renderCategoryTab(body, cat);
  pollTimer = setInterval(
    () =>
      authed('/api/admin/data')
        .then((d) => {
          D = d;
          const c = D.categories.find((x) => x.id === tab);
          if (c) renderCategoryTab(document.getElementById('tabBody'), c);
        })
        .catch(() => {}),
    10000,
  );
}

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `notice ${kind}`;
  t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9;box-shadow:var(--shadow)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

const d1 = (n) => Math.round(Number(n || 0) * 10) / 10;
function parseNums(s) {
  return String(s || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/* ------------------------------------------------------------------ */
/* 전체 설정 탭                                                         */
/* ------------------------------------------------------------------ */
function renderGlobal(root) {
  const c = D.config;
  root.innerHTML = `
    <div class="card">
      <h2>항목 진행 현황</h2>
      <div class="table-scroll">
        <table class="data"><thead><tr><th>항목</th><th>단계</th><th>후보</th><th class="num">1차</th><th class="num">2차</th></tr></thead>
        <tbody>${D.categories
          .map(
            (cat) => `<tr>
            <td><a href="#" data-goto="${cat.id}">${esc(cat.name)}</a></td>
            <td>${PHASES.find((p) => p[0] === cat.phase)?.[1] || cat.phase}</td>
            <td class="num">${cat.candidates.length}</td>
            <td class="num">${cat.ballotCounts.round1}</td>
            <td class="num">${cat.ballotCounts.round2}</td>
          </tr>`,
          )
          .join('')}</tbody></table>
      </div>
    </div>

    <div class="card">
      <h2>이름 제안</h2>
      <label class="field" style="max-width:320px">
        <span>이름 제안 받기</span>
        <select id="submissionsOpen">
          <option value="true" ${c.submissionsOpen ? 'selected' : ''}>열림 (준비 단계 항목에서 제안 가능)</option>
          <option value="false" ${!c.submissionsOpen ? 'selected' : ''}>닫힘</option>
        </select>
      </label>
      <p class="hint">아무 항목이든 1차 투표를 시작하면 <b>전체 항목의 이름 제안이 자동으로 닫힙니다.</b> 여기서 수동으로 미리 닫거나 다시 열 수도 있습니다.</p>
      <label class="field" style="max-width:220px"><span>1인당 항목당 최대 제안 개수</span>
        <div class="btn-row">
          <input type="number" id="maxProp" value="${c.maxProposalsPerCategory ?? 2}" min="1" max="30" style="width:80px" />
          <button id="saveMaxProp">적용</button>
        </div>
      </label>
    </div>

    <div class="card">
      <h2>공통 설정</h2>
      <label class="field">
        <span>투표 인원 (번호 방식이면 1~이 수 · 도달 시 자동 마감 · 0 = 무제한)</span>
        <div class="btn-row">
          <input type="number" id="expected" value="${c.expectedVoters ?? 19}" min="0" max="100000" style="width:110px" />
          <button id="saveExpected">적용</button>
        </div>
      </label>
      <label class="field" style="max-width:420px">
        <span>투표 참여 방식</span>
        <select id="voterMode">
          <option value="number" ${c.useVoterNumbers ? 'selected' : ''}>본인 번호 입력 (1 ~ ${c.expectedVoters ?? 19})</option>
          <option value="open" ${!c.useVoterNumbers ? 'selected' : ''}>번호 없이 (링크만 · 브라우저 기준 중복 방지)</option>
        </select>
      </label>
      <p class="hint">
        <b>번호 방식</b>: 투표자가 배정받은 번호를 입력하고 시작. 번호당 1회만 가능하고 브라우저 데이터와 무관합니다.
        이름 제안 시에는 항상 번호를 입력합니다(항목별 개수 제한을 위해). 각자에게 1~${c.expectedVoters ?? 19}번을 나눠 주세요.<br />
        <b>번호 없이</b>: 투표만 링크로 바로(같은 브라우저 재투표 방지). 이름 제안은 이 설정과 무관하게 항상 번호가 필요합니다.
      </p>
    </div>

    <div class="card">
      <h2>공모전 정보</h2>
      <label class="field"><span>제목</span><input type="text" id="title" value="${esc(c.title)}" /></label>
      <label class="field"><span>부제</span><input type="text" id="subtitle" value="${esc(c.subtitle || '')}" /></label>
      <label class="field" style="max-width:260px"><span>상금 (원, 항목별 각각 수여)</span>
        <input type="number" id="prize" value="${c.prize}" min="0" step="10000" /></label>
      <button class="btn-primary" id="saveInfo">정보 저장</button>
    </div>`;

  root.querySelectorAll('[data-goto]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      tab = a.dataset.goto;
      renderTab();
    }),
  );

  document.getElementById('submissionsOpen').addEventListener('change', async (e) => {
    await authed('/api/admin/config', { method: 'PUT', body: { submissionsOpen: e.target.value === 'true' } });
    await refresh();
    toast('이름 제안 설정을 저장했습니다.');
  });

  document.getElementById('saveMaxProp').addEventListener('click', async () => {
    await authed('/api/admin/config', {
      method: 'PUT',
      body: { maxProposalsPerCategory: Number(document.getElementById('maxProp').value) },
    });
    await refresh();
    toast('제안 개수 제한을 저장했습니다.');
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
    await authed('/api/admin/config', { method: 'PUT', body: { useVoterNumbers: e.target.value === 'number' } });
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
}

/* ------------------------------------------------------------------ */
/* 항목별 탭                                                            */
/* ------------------------------------------------------------------ */
function renderCategoryTab(root, cat) {
  root.innerHTML = `
    ${descCard(cat)}
    ${phaseCard(cat)}
    ${voteConfigCard(cat)}
    ${candidatesCard(cat)}
    ${proposalCard(cat)}
    ${resultsCard(cat)}
    ${dangerCard(cat)}
  `;
  wireDescCard(root, cat);
  wirePhaseCard(root, cat);
  wireVoteConfigCard(root, cat);
  wireCandidatesCard(root, cat);
  wireDangerCard(root, cat);
}

function descCard(cat) {
  return `
    <div class="card">
      <h2>항목 설명</h2>
      <p class="hint">투표자가 이름을 제안/투표하기 전에 보는 설명입니다.</p>
      <label class="field"><span>항목 이름</span><input type="text" id="catName" value="${esc(cat.name)}" /></label>
      <label class="field"><span>설명</span><textarea id="catDesc" style="min-height:90px">${esc(cat.description)}</textarea></label>
      <label class="field"><span>유사 사례 (쉼표 구분)</span><input type="text" id="catExamples" value="${esc((cat.examples || []).join(', '))}" /></label>
      <button class="btn-primary" id="saveDesc">설명 저장</button>
    </div>`;
}
function wireDescCard(root, cat) {
  document.getElementById('saveDesc').addEventListener('click', async () => {
    await authed(`/api/admin/category/${cat.id}`, {
      method: 'PUT',
      body: {
        name: document.getElementById('catName').value,
        description: document.getElementById('catDesc').value,
        examples: document.getElementById('catExamples').value.split(',').map((s) => s.trim()).filter(Boolean),
      },
    });
    await refresh();
    toast('항목 설명을 저장했습니다.');
  });
}

function phaseCard(cat) {
  return `
    <div class="card">
      <h2>단계 진행</h2>
      <p class="hint">현재: <b>${PHASES.find((p) => p[0] === cat.phase)?.[1] || cat.phase}</b> ·
        1차 ${cat.ballotCounts.round1}표 / 2차 ${cat.ballotCounts.round2}표.
        (1차·2차 시작은 이름이 2개 이상 있어야 합니다. 이 항목이 준비 단계를 벗어나면 <b>전체 항목의 이름 제안이 동시에 마감</b>됩니다.)</p>
      <div class="phasebar">
        ${PHASES.map(([k, l]) => `<button data-phase="${k}" class="${cat.phase === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <div id="phaseErr" class="mt"></div>
    </div>`;
}
function wirePhaseCard(root, cat) {
  root.querySelectorAll('[data-phase]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await authed(`/api/admin/category/${cat.id}/phase`, { method: 'PUT', body: { phase: b.dataset.phase } });
        await refresh();
        toast('단계를 변경했습니다.');
      } catch (e) {
        document.getElementById('phaseErr').innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      }
    }),
  );
}

function voteConfigCard(cat) {
  return `
    <div class="card">
      <h2>투표 방식 설정</h2>
      <label class="field" style="max-width:320px">
        <span>결과 페이지(/results) 공개</span>
        <select id="resPub">
          <option value="false" ${!cat.resultsPublic ? 'selected' : ''}>비공개 (마감 후 자동 공개)</option>
          <option value="true" ${cat.resultsPublic ? 'selected' : ''}>지금 공개</option>
        </select>
      </label>
      <div class="grid-2">
        <label class="field"><span>1차 토큰(총점)</span>
          <input type="number" id="tb1" value="${cat.round1.tokenBudget ?? 100}" min="1" step="10" /></label>
        <label class="field"><span>1차 최대 선택 이름 수</span>
          <input type="number" id="mp1" value="${cat.round1.maxPicks ?? 5}" min="1" max="30" /></label>
      </div>
      <label class="field"><span>2차 순위별 점수 (쉼표 구분 · 개수 = 선택 가능 수)</span>
        <input type="text" id="p2" value="${cat.round2.points.join(', ')}" /></label>
      <div class="grid-2">
        <label class="field"><span>종합 반영 비율 — 1차</span>
          <input type="number" id="sw1" value="${cat.round1.scoreWeight ?? 1}" min="0" step="0.5" /></label>
        <label class="field"><span>종합 반영 비율 — 2차</span>
          <input type="number" id="sw2" value="${cat.round2.scoreWeight ?? 1}" min="0" step="0.5" /></label>
      </div>
      <button class="btn-primary" id="saveVote">방식 저장</button>
      <p class="hint mt">
        <b>1차</b>: 토큰 ${cat.round1.tokenBudget ?? 100}점을 최대 ${cat.round1.maxPicks ?? 5}개 이름에 0~${cat.round1.tokenBudget ?? 100}점 자유 배분(합계 = 토큰).
        <b>2차</b>: 순위별 고정 점수.
        <b>종합</b>: 각 라운드를 100점 만점으로 환산한 뒤 위 비율로 합산합니다 (1:1이면 동일 무게).
      </p>
    </div>`;
}
function wireVoteConfigCard(root, cat) {
  document.getElementById('resPub').addEventListener('change', async (e) => {
    await authed(`/api/admin/category/${cat.id}/config`, { method: 'PUT', body: { resultsPublic: e.target.value === 'true' } });
    toast('결과 공개 설정을 저장했습니다.');
  });
  document.getElementById('saveVote').addEventListener('click', async () => {
    const tb = Number(document.getElementById('tb1').value);
    const mp = Number(document.getElementById('mp1').value);
    const p = parseNums(document.getElementById('p2').value);
    if (!(tb >= 1) || !(mp >= 1) || !p.length) return toast('값을 확인하세요.', 'err');
    await authed(`/api/admin/category/${cat.id}/config`, {
      method: 'PUT',
      body: {
        round1: { tokenBudget: tb, maxPicks: mp, scoreWeight: Number(document.getElementById('sw1').value) },
        round2: { points: p, scoreWeight: Number(document.getElementById('sw2').value) },
      },
    });
    await refresh();
    toast('투표 방식을 저장했습니다.');
  });
}

function candidatesCard(cat) {
  return `
    <div class="card">
      <h2>제안된 이름 ${cat.candidates.length}개</h2>
      <p class="hint">직원들이 준비 단계에서 직접 제안한 이름입니다. 상표 중복 등은 제안자 책임이며, 스팸·중복은 여기서 숨기거나 삭제하세요.</p>
      <div id="cands"></div>
      <button class="btn-primary btn-lg" id="saveCands">변경 사항 저장</button>
      <div class="card" style="margin-top:16px;background:transparent">
        <h2 style="font-size:1rem">이름 직접 추가 (관리자)</h2>
        <div class="btn-row" style="margin-bottom:8px">
          <input type="text" id="newName" placeholder="이름" style="flex:1 1 160px" />
          <select id="newKind" style="flex:0 1 110px">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select>
          <input type="text" id="newEnglish" placeholder="영문 표기" style="flex:1 1 140px" />
        </div>
        <div class="btn-row" style="margin-bottom:8px">
          <input type="text" id="newDesc" placeholder="이름 설명 (한두 줄, 선택)" style="flex:1 1 260px" />
        </div>
        <div class="btn-row">
          <input type="number" id="newProposer" placeholder="제안자 번호 (선택)" style="flex:0 1 160px" />
          <button id="addCand">추가</button>
        </div>
      </div>
    </div>`;
}
function wireCandidatesCard(root, cat) {
  document.getElementById('cands').innerHTML = cat.candidates
    .map(
      (c, i) => `
    <div class="adm-cand" data-id="${c.id}" style="${c.hidden ? 'border-color:var(--danger)' : ''}">
      <div class="row1">
        <div class="idx">${i + 1}</div>
        <input type="text" data-f="name" placeholder="이름" value="${esc(c.name)}" />
        <select data-f="kind">${KINDS.map((k) => `<option ${c.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <input type="text" data-f="english" placeholder="영문 표기" value="${esc(c.english)}" />
      </div>
      <input type="text" data-f="description" placeholder="이름 설명 (한두 줄)" value="${esc(c.description || '')}" style="width:100%;margin-top:6px" />
      <div class="row2">
        <span class="tag">제안자 ${c.proposer != null ? `${c.proposer}번` : '—'}</span>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''} /> 투표 대상에서 숨김</label>
        <button data-del="${c.id}" class="btn-danger" style="margin-left:auto">삭제</button>
      </div>
    </div>`,
    )
    .join('');

  document.getElementById('saveCands').addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('.adm-cand')].map((el) => {
      const get = (f) => el.querySelector(`[data-f="${f}"]`);
      return {
        id: el.dataset.id,
        name: get('name').value.trim(),
        kind: get('kind').value,
        english: get('english').value.trim(),
        description: get('description').value.trim(),
        hidden: get('hidden').checked,
      };
    });
    await authed(`/api/admin/category/${cat.id}/candidates`, { method: 'PUT', body: { candidates: rows } });
    await refresh();
    toast('저장했습니다.');
  });

  root.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('이 이름을 삭제할까요?')) return;
      await authed(`/api/admin/category/${cat.id}/candidates/${b.dataset.del}`, { method: 'DELETE' });
      await refresh();
      toast('삭제했습니다.');
    }),
  );

  document.getElementById('addCand').addEventListener('click', async () => {
    const name = document.getElementById('newName').value.trim();
    if (!name) return toast('이름을 입력하세요.', 'err');
    await authed(`/api/admin/category/${cat.id}/candidates`, {
      method: 'POST',
      body: {
        name,
        kind: document.getElementById('newKind').value,
        english: document.getElementById('newEnglish').value.trim(),
        description: document.getElementById('newDesc').value.trim(),
        proposer: document.getElementById('newProposer').value ? Number(document.getElementById('newProposer').value) : null,
      },
    });
    await refresh();
    toast('추가했습니다.');
  });
}

function proposalCard(cat) {
  const max = D.config.expectedVoters || 0;
  const counts = cat.proposalCounts || {};
  const rows = [];
  for (let i = 1; i <= max; i++) rows.push(counts[i] || 0);
  const done = rows.filter((n) => n > 0).length;
  return `
    <div class="card">
      <h2>제안 현황 (번호별)</h2>
      <p class="hint">이 항목에 이름을 1개 이상 제안한 사람: ${done} / ${max}명</p>
      <div class="table-scroll">
        <table class="data"><thead><tr><th>번호</th><th class="num">제안 개수</th></tr></thead>
        <tbody>${Array.from({ length: max }, (_, i) => i + 1)
          .map((n) => `<tr><td>${n}번</td><td class="num">${counts[n] || 0}</td></tr>`)
          .join('')}</tbody></table>
      </div>
    </div>`;
}

function scoreTable(section) {
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
      <table class="data"><thead><tr><th>순위</th><th>이름</th><th>영문</th><th class="num">점수</th><th class="num">${
        section.tokenBudget != null ? '최고배점' : '1순위표'
      }</th></tr></thead>
      <tbody>${section.rows
        .map(
          (x) => `<tr class="${x.rank === 1 ? 'top1' : ''}"><td class="num">${x.rank}</td><td>${esc(x.name)}</td>
          <td class="muted">${esc(x.english || '')}</td><td class="num">${d1(x.score)}</td><td class="num">${x.firsts}</td></tr>`,
        )
        .join('')}</tbody></table>
    </div>`;
}

function resultsCard(cat) {
  const r = cat.results;
  const cr = r.combineRatio || { round1: 1, round2: 1 };
  const ratioTxt = cr.round1 === cr.round2 ? '1 : 1 (동일 무게)' : `1차 ${cr.round1} : 2차 ${cr.round2}`;
  return `
    <div class="card">
      <h2>종합 집계 (1차 + 2차)</h2>
      <p class="hint">각 라운드를 100점 만점으로 환산 후 <b>${ratioTxt}</b> 비율로 합산. (아래 열은 환산값)</p>
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

    ${D.config.useVoterNumbers && D.config.expectedVoters >= 1 ? voterNumberCard(cat) : ''}

    <div class="card"><h2>1차 집계</h2>${scoreTable(r.round1)}</div>
    <div class="card"><h2>2차 집계</h2>${scoreTable(r.round2)}</div>`;
}

function voterNumberCard(cat) {
  const max = D.config.expectedVoters;
  const vn = cat.votedNumbers || { round1: [], round2: [] };
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
  </div>`;
}

function dangerCard(cat) {
  return `
    <div class="card" style="border-color:color-mix(in srgb,var(--danger) 40%,transparent)">
      <h2 style="color:var(--danger)">위험 구역 (이 항목만 초기화)</h2>
      <p class="hint">1차/2차 초기화는 해당 라운드의 투표 기록만 삭제합니다. <b>전체 초기화는 투표 기록뿐 아니라 직원들이 제안한 이름도 모두 삭제</b>하고 준비 단계로 되돌립니다. 되돌릴 수 없습니다.</p>
      <div class="btn-row">
        <button class="btn-danger" data-reset="round1">1차 투표 초기화</button>
        <button class="btn-danger" data-reset="round2">2차 투표 초기화</button>
        <button class="btn-danger" data-reset="all">전체 초기화 (제안 이름 포함 삭제 + 준비 단계로)</button>
      </div>
    </div>`;
}
function wireDangerCard(root, cat) {
  root.querySelectorAll('[data-reset]').forEach((b) =>
    b.addEventListener('click', async () => {
      const what = b.dataset.reset;
      const msg =
        what === 'all'
          ? `정말 "${cat.name}" 항목을 전체 초기화할까요? 투표 기록과 직원들이 제안한 이름까지 모두 삭제되고 준비 단계로 돌아갑니다. 되돌릴 수 없습니다.`
          : `정말 "${cat.name}" 항목의 "${what}" 를 초기화할까요? 되돌릴 수 없습니다.`;
      if (!confirm(msg)) return;
      if (!confirm('한 번 더 확인합니다. 초기화를 진행합니다.')) return;
      await authed(`/api/admin/category/${cat.id}/reset`, { body: { what } });
      await refresh();
      toast('초기화했습니다.');
    }),
  );
}
