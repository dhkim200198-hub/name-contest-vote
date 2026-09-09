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
        ['codes', '투표 코드'],
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
  if (tab === 'codes') renderCodes(body);
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
      <p class="hint">현재: <b>${PHASES.find((p) => p[0] === c.phase)?.[1] || c.phase}</b>.
        단계를 바꾸면 투표 페이지가 즉시 반영됩니다. (1차/2차 시작은 코드·후보 조건이 충족돼야 합니다)</p>
      <div class="phasebar">
        ${PHASES.map(([k, l]) => `<button data-phase="${k}" class="${c.phase === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <div id="phaseErr" class="mt"></div>
      <label class="field mt" style="max-width:260px">
        <span>결과 페이지(/results) 공개</span>
        <select id="resPub">
          <option value="false" ${!c.resultsPublic ? 'selected' : ''}>비공개 (마감 후 자동 공개)</option>
          <option value="true" ${c.resultsPublic ? 'selected' : ''}>지금 공개</option>
        </select>
      </label>
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
        <label class="field"><span>1차 순위별 배점 (쉼표 구분 · 개수 = 선택 가능 수)</span>
          <input type="text" id="w1" value="${c.round1.weights.join(', ')}" /></label>
        <label class="field"><span>2차 순위별 점수 (쉼표 구분)</span>
          <input type="text" id="p2" value="${c.round2.points.join(', ')}" /></label>
      </div>
      <p class="hint" id="w1sum"></p>
      <div class="grid-2">
        <label class="field"><span>종합 점수에 1차 반영 배율</span>
          <input type="number" id="sw1" value="${c.round1.scoreWeight ?? 1}" min="0" step="0.1" /></label>
        <label class="field"><span>종합 점수에 2차 반영 배율</span>
          <input type="number" id="sw2" value="${c.round2.scoreWeight ?? 1}" min="0" step="0.1" /></label>
      </div>
      <button class="btn-primary" id="saveVote">방식 저장</button>
      <p class="hint mt">
        1차·2차 모두 이름 전체를 대상으로 투표하고, <b>최종 순위 = (1차 점수 × 1차 배율) + (2차 점수 × 2차 배율)</b> 로 합산합니다.<br />
        기본값 — 이름 4개 / 1차 순위별 60·30·10·0점 / 2차 순위별 5·4·3·2·1점 / 배율 1 : 1.
        <br />※ 1차 배점 합(100)이 2차(≤14)보다 크므로, 두 라운드를 대등하게 보려면 예: 1차 배율 0.14 정도로 낮추세요.
      </p>
    </div>

    <div class="card" style="border-color:color-mix(in srgb,var(--danger) 40%,transparent)">
      <h2 style="color:var(--danger)">위험 구역</h2>
      <p class="hint">초기화하면 해당 라운드의 투표 기록이 삭제되고 코드가 다시 미사용 상태가 됩니다.</p>
      <div class="btn-row">
        <button class="btn-danger" data-reset="round1">1차 투표 초기화</button>
        <button class="btn-danger" data-reset="round2">2차 투표 초기화</button>
        <button class="btn-danger" data-reset="all">전체 초기화</button>
      </div>
    </div>`;

  const sumW1 = () => {
    const arr = parseNums(document.getElementById('w1').value);
    document.getElementById('w1sum').textContent = `슬롯 ${arr.length}개 · 합계 ${arr.reduce((a, b) => a + b, 0)}점`;
  };
  document.getElementById('w1').addEventListener('input', sumW1);
  sumW1();

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
    const w = parseNums(document.getElementById('w1').value);
    const p = parseNums(document.getElementById('p2').value);
    if (!w.length || !p.length) return toast('배점을 확인하세요.', 'err');
    await authed('/api/admin/config', {
      method: 'PUT',
      body: {
        round1: { weights: w, scoreWeight: Number(document.getElementById('sw1').value) },
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
/* 코드 탭                                                             */
/* ------------------------------------------------------------------ */
function renderCodes(root) {
  root.innerHTML = `
    <div class="card">
      <h2>투표 코드</h2>
      <p class="hint">라운드별로 코드를 발급해 사내 메신저 등으로 1인 1개씩 배포하세요.
        코드 수만큼만 투표가 가능하므로 별도 로그인이 필요 없습니다.
        표가 한 장이라도 들어오면 재발급이 막힙니다(초기화 후 가능).</p>
      <div id="r1"></div>
      <div id="r2" class="mt"></div>
    </div>`;
  renderCodeBlock(document.getElementById('r1'), 1);
  renderCodeBlock(document.getElementById('r2'), 2);
}

function renderCodeBlock(root, round) {
  const codes = round === 1 ? D.codes.round1 : D.codes.round2;
  const ballots = round === 1 ? D.ballotCounts.round1 : D.ballotCounts.round2;
  const used = codes.filter((c) => c.used).length;
  root.innerHTML = `
    <h3 style="margin-bottom:6px">${round}차 코드 — ${codes.length}개 발급${codes.length ? ` · ${used}개 사용` : ''}</h3>
    <div class="btn-row" style="margin-bottom:10px">
      <input type="number" id="cnt${round}" value="19" min="1" max="200" style="width:90px" />
      <button class="btn-primary" id="gen${round}" ${ballots > 0 ? 'disabled' : ''}>코드 생성 / 재발급</button>
      ${codes.length ? `<button id="copy${round}">전체 복사</button><button id="csv${round}">CSV 내려받기</button>` : ''}
    </div>
    ${ballots > 0 ? `<div class="notice" style="margin-bottom:10px">이미 ${ballots}표가 접수되어 재발급이 잠겼습니다. "설정 → 위험 구역"에서 초기화하면 다시 생성할 수 있습니다.</div>` : ''}
    ${
      codes.length
        ? `<div class="table-scroll"><table class="data"><thead><tr><th>#</th><th>코드</th><th>상태</th></tr></thead>
        <tbody>${codes
          .map(
            (c, i) =>
              `<tr><td class="num">${i + 1}</td><td><code class="mono">${c.code}</code></td>
             <td>${c.used ? `<span class="tag no">사용됨 · ${new Date(c.usedAt).toLocaleString('ko-KR')}</span>` : '<span class="tag ok">미사용</span>'}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
        : '<p class="muted">아직 생성된 코드가 없습니다.</p>'
    }`;

  const genBtn = document.getElementById(`gen${round}`);
  if (genBtn && !genBtn.disabled) {
    genBtn.addEventListener('click', async () => {
      const count = Number(document.getElementById(`cnt${round}`).value) || 19;
      if (codes.length && !confirm('기존 코드를 모두 새 코드로 교체합니다. 계속할까요?')) return;
      try {
        await authed('/api/admin/codes', { body: { round, count } });
        await refresh();
        toast(`${round}차 코드를 생성했습니다.`);
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }
  document.getElementById(`copy${round}`)?.addEventListener('click', () => {
    navigator.clipboard.writeText(codes.map((c) => c.code).join('\n')).then(() => toast('클립보드에 복사했습니다.'));
  });
  document.getElementById(`csv${round}`)?.addEventListener('click', () => {
    const csv = '번호,코드,상태\n' + codes.map((c, i) => `${i + 1},${c.code},${c.used ? '사용됨' : '미사용'}`).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `round${round}-codes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/* ------------------------------------------------------------------ */
/* 결과 탭                                                             */
/* ------------------------------------------------------------------ */
function scoreTable(section, extraHead = '', extraCell = () => '') {
  return `
    <div class="grid-2">
      <div class="stat"><div class="k">투표 수</div><div class="v">${section.totalBallots}</div></div>
      <div class="stat"><div class="k">사용 코드</div><div class="v">${section.usedCodes}/${section.codeCount}</div></div>
      <div class="stat"><div class="k">배점</div><div class="v" style="font-size:1rem">${(section.weights || section.points).join(' · ')}</div></div>
    </div>
    <div class="table-scroll mt">
      <table class="data"><thead><tr><th>순위</th><th>이름</th><th>영문</th>${extraHead}<th class="num">점수</th><th class="num">1순위표</th></tr></thead>
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
  const sw = r.scoreWeights || { round1: 1, round2: 1 };

  root.innerHTML = `
    <div class="card">
      <h2>종합 집계 (1차 + 2차)</h2>
      <p class="hint">최종 순위 = (1차 점수 × ${sw.round1}) + (2차 점수 × ${sw.round2}). 배율은 <b>설정</b> 탭에서 조정합니다.</p>
      ${
        r.winner && r.combined.some((x) => x.score > 0)
          ? `<div class="prize mt">🏆 <span>현재 1위: <b>${esc(r.winner.name)}</b>${
              r.winner.english ? ` (${esc(r.winner.english)})` : ''
            } — 종합 ${d1(r.winner.score)}점 · 상금 ${won(r.prize)} 대상</span></div>`
          : '<p class="hint">아직 집계된 표가 없습니다.</p>'
      }
      <div class="table-scroll mt">
        <table class="data"><thead><tr><th>순위</th><th>이름</th><th>영문</th>
          <th class="num">1차</th><th class="num">2차</th><th class="num">종합</th></tr></thead>
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

    <div class="card"><h2>1차 집계</h2>${scoreTable(r.round1)}</div>
    <div class="card"><h2>2차 집계</h2>${scoreTable(r.round2)}</div>
    <p class="muted" style="font-size:.82rem">10초마다 자동 갱신됩니다.</p>`;
}

const d1 = (n) => Math.round(Number(n || 0) * 10) / 10;

/* ------------------------------------------------------------------ */
function parseNums(s) {
  return String(s || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}
