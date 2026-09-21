import { api, esc, won } from '/api.js';

const view = document.getElementById('view');
const backLink = document.getElementById('backLink');

const PHASE_LABEL = {
  prep: '준비 중 · 이름 제안',
  round1_open: '1차 투표 진행 중',
  round1_closed: '1차 투표 마감',
  round2_open: '2차 투표 진행 중',
  round2_closed: '2차 투표 마감',
  done: '최종 발표',
};
const PHASE_MSG = {
  round1_closed: '1차 투표가 마감되었습니다. 2차 투표 안내를 기다려 주세요.',
  round2_closed: '2차 투표가 마감되었습니다. 곧 최종 결과가 발표됩니다.',
  done: '공모전이 종료되었습니다. 결과 페이지에서 최종 선정된 이름을 확인하세요.',
};

const KIPRIS_URL = 'https://www.kipris.or.kr/khome/search/searchResult.do?tab=trademark';
function webSearchUrl(name) {
  const q = (name ? name + ' ' : '') + '상표 trademark 소프트웨어';
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function voterKey() {
  try {
    let k = localStorage.getItem('voterKey');
    if (!k) {
      k = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
      localStorage.setItem('voterKey', k);
    }
    return k;
  } catch {
    return 'k' + Date.now() + Math.random();
  }
}
function markVoted(categoryId, round) {
  try {
    localStorage.setItem(`voted_${categoryId}_round${round}`, new Date().toISOString());
  } catch {
    /* ignore */
  }
}
function hasVoted(categoryId, round) {
  try {
    return !!localStorage.getItem(`voted_${categoryId}_round${round}`);
  } catch {
    return false;
  }
}

let st = null; // /api/state 결과 (전역 + 항목 요약)

backLink.addEventListener('click', (e) => {
  e.preventDefault();
  goGrid();
});

init();

async function init() {
  try {
    st = await api('/api/state');
    document.getElementById('title').textContent = st.title;
    document.getElementById('subtitle').textContent = st.subtitle || '';
    if (st.prize > 0) {
      document.getElementById('prizeAmt').textContent = won(st.prize);
      document.getElementById('prize').hidden = false;
    }
    goGrid();
  } catch (e) {
    view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
  }
}

async function goGrid() {
  backLink.hidden = true;
  try {
    st = await api('/api/state');
  } catch (e) {
    view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    return;
  }
  renderGrid();
}

function actionFor(cat) {
  if (cat.phase === 'prep') {
    return { label: '이름 제안하기', go: () => goProposeIntro(cat.id) };
  }
  if (cat.phase === 'round1_open' || cat.phase === 'round2_open') {
    if (cat.full) return { label: `${cat.activeRound}차 투표 마감`, disabled: true };
    return { label: '투표하기', go: () => goVote(cat.id) };
  }
  return { label: '결과 보기', href: '/results' };
}

function renderGrid() {
  view.innerHTML = `
    <div class="card">
      <h2>이름 공모전 안내</h2>
      <p class="hint">
        이번 공모전에서는 아래 <b>4개 항목</b>의 이름을 각각 정합니다. 항목마다 진행 단계가 다를 수 있습니다.
        준비 중인 항목은 각자 <b>본인 번호</b>를 입력해 이름을 <b>최대 ${st.maxProposalsPerCategory}개</b>까지 제안할 수 있고,
        투표가 시작된 항목은 1차·2차 투표에 참여할 수 있습니다.
        제안하는 이름은 <b>순수한글 또는 한자(漢字) 기반</b>이어야 하며, 순수한글인 경우 영문 표기가 자연스러운 것이 좋습니다.
      </p>
      <p class="hint">
        📅 <b>이름 접수는 9월 30일까지</b> 마감하며, <b>10월 1일 전체 인원이 모여 1차·2차 투표를 진행</b>합니다.
      </p>
    </div>
    <div class="catgrid">
      ${st.categories
        .map((cat) => {
          const act = actionFor(cat);
          const seat = cat.activeRound ? `<span class="tag">${cat.count}${st.expectedVoters ? ` / ${st.expectedVoters}` : ''}명 참여</span>` : '';
          return `
        <div class="catcard">
          <div class="catbadge">${esc(PHASE_LABEL[cat.phase] || cat.phase)}</div>
          <h3>${esc(cat.name)}</h3>
          <p class="hint">${esc(cat.description)}</p>
          ${cat.examples?.length ? `<p class="muted" style="font-size:.85rem">유사 사례: ${cat.examples.map(esc).join(', ')}</p>` : ''}
          ${seat}
          <div class="mt">
            ${
              act.href
                ? `<a class="btn-primary btn-block" href="${act.href}">${esc(act.label)}</a>`
                : `<button class="btn-primary btn-block" data-go="${cat.id}" ${act.disabled ? 'disabled' : ''}>${esc(act.label)}</button>`
            }
          </div>
        </div>`;
        })
        .join('')}
    </div>`;
  view.querySelectorAll('[data-go]').forEach((btn) => {
    const cat = st.categories.find((c) => c.id === btn.dataset.go);
    const act = actionFor(cat);
    if (act.go) btn.addEventListener('click', act.go);
  });
}

/* ------------------------------------------------------------------ */
/* 이름 제안 (준비 단계)                                                 */
/* ------------------------------------------------------------------ */
let proposeNumber = null;
let proposeMine = null;

function goProposeIntro(categoryId) {
  backLink.hidden = false;
  renderProposeIntro(categoryId);
}

function renderProposeIntro(categoryId) {
  const cat = st.categories.find((c) => c.id === categoryId);
  view.innerHTML = `
    <div class="card">
      <h2>이 투표 시스템은 무엇인가요?</h2>
      <p class="hint">
        회사에서 새로 지어야 할 이름 4가지를 사내 공모전으로 정합니다. 지금은 <b>이름 제안(준비) 단계</b>이며,
        이 단계에서 직원 누구나 <b>본인 번호</b>를 입력해 원하는 이름을 <b>항목당 최대 ${st.maxProposalsPerCategory}개</b>까지 제안할 수 있습니다(1개만 제안해도 됩니다).
        <b>각 항목은 그 항목의 1차 투표가 시작되면 그 항목의 이름 제안만 마감</b>되고(다른 항목은 영향받지 않습니다), 그 뒤로는 제안된 이름들로만 투표가 진행됩니다.
        제안하는 이름은 <b>순수한글 또는 한자(漢字) 기반</b>이어야 하며, 순수한글인 경우 영문 표기가 자연스러운 것이 좋습니다.
        상표(商標) 중복 여부는 <b>제안하는 본인이 미리 확인</b>해 주세요.
      </p>
      <p class="hint">
        📅 <b>이름 접수는 9월 30일까지</b> 마감하며, <b>10월 1일 전체 인원이 모여 1차·2차 투표를 진행</b>합니다.
      </p>
      ${trademarkLinksHtml(null, 'introKipris', 'introWebSearch')}
    </div>
    <div class="card">
      <h2>지금 제안할 항목: ${esc(cat.name)}</h2>
      <p class="hint">${esc(cat.description)}</p>
      ${cat.examples?.length ? `<p class="muted">유사 사례: ${cat.examples.map(esc).join(', ')}</p>` : ''}
      <button class="btn-primary btn-lg btn-block mt" id="proposeGo">확인했습니다, 이름 제안하기</button>
    </div>`;
  document.getElementById('proposeGo').addEventListener('click', () => renderProposeNumberEntry(categoryId));
}

function renderProposeNumberEntry(categoryId) {
  const max = st.expectedVoters;
  view.innerHTML = `
    <div class="card">
      <h2>본인 번호 입력</h2>
      <p class="hint">배정받은 <b>본인 번호(1 ~ ${max})</b>를 입력하세요. 이 번호로 항목별 제안 개수가 관리됩니다.</p>
      <label class="field">
        <span>내 번호</span>
        <input type="number" id="pnum" min="1" max="${max}" inputmode="numeric" class="code-input" placeholder="0" />
      </label>
      <div id="pnumErr"></div>
      <button class="btn-primary btn-lg btn-block" id="pnumGo">다음</button>
    </div>`;
  const input = document.getElementById('pnum');
  const go = async () => {
    const n = Number(input.value);
    const errBox = document.getElementById('pnumErr');
    if (!Number.isInteger(n) || n < 1 || n > max) {
      errBox.innerHTML = `<div class="notice err">1 ~ ${max} 사이 번호를 입력하세요.</div>`;
      return;
    }
    document.getElementById('pnumGo').disabled = true;
    errBox.innerHTML = '';
    try {
      const r = await api('/api/propose/check', { body: { voterNumber: n } });
      proposeNumber = n;
      proposeMine = r.mine;
      renderProposeForm(categoryId);
    } catch (e) {
      errBox.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      document.getElementById('pnumGo').disabled = false;
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  document.getElementById('pnumGo').addEventListener('click', go);
  input.focus();
}

let editingCandidateId = null; // 인라인 수정 중인 내 제안 id

function trademarkLinksHtml(webSearchInputId, kiprisId, searchId) {
  return `<p class="hint">
    상표 중복 여부는 제안 전 직접 확인해 주세요:
    <a id="${kiprisId}" href="${KIPRIS_URL}" target="_blank" rel="noopener">KIPRIS 상표검색</a> ·
    <a id="${searchId}" href="${webSearchUrl('')}" target="_blank" rel="noopener">웹검색</a>
  </p>
  <div class="kipris-guide">
    <p class="hint">
      <b>KIPRIS 검색 필터 체크 방법</b>: 왼쪽 <b>권리구분</b> 필터에서 <b>상표(40)</b>와 <b>상표/서비스표(45)</b> 두 항목이
      모두 체크되어 있어야 합니다. 둘 중 하나에서라도 동일하거나 비슷한 표장이 있으면 중복으로 간주하고 다른 이름을 제안해 주세요.
    </p>
    <img src="/kipris-filter-guide.png" alt="KIPRIS 검색필터: 상표, 상표/서비스표 체크 예시" class="kipris-guide-img" />
  </div>`;
}

function renderProposeForm(categoryId) {
  const cat = st.categories.find((c) => c.id === categoryId);
  const mine = proposeMine[categoryId] || { count: 0, names: [] };
  const max = st.maxProposalsPerCategory;
  const full = mine.count >= max;
  view.innerHTML = `
    <div class="card">
      <h2>${esc(cat.name)} · 이름 제안</h2>
      <p class="hint"><span class="tag">내 번호 ${proposeNumber}번</span> · 이 항목 제안 ${mine.count} / 최대 ${max}개 (1개만 제안해도 됩니다)</p>
      ${
        mine.names.length
          ? `<div class="rankpanel"><b>내가 제안한 이름</b><ol>${mine.names
              .map((n) =>
                editingCandidateId === n.id
                  ? `<li class="rankrow" id="editRow-${n.id}">
                      <div class="mt" style="width:100%">
                        <label class="field"><span>이름</span><input type="text" id="eName" maxlength="60" value="${esc(n.name)}" /></label>
                        ${trademarkLinksHtml(null, 'eKipris', 'eWebSearch')}
                        <div class="grid-2">
                          <label class="field"><span>구분</span>
                            <select id="eKind">
                              <option ${n.kind === '순수한글' ? 'selected' : ''}>순수한글</option>
                              <option ${n.kind === '한자' ? 'selected' : ''}>한자</option>
                            </select>
                          </label>
                          <label class="field"><span>영문 표기 (필수)</span><input type="text" id="eEng" maxlength="80" value="${esc(n.english || '')}" /></label>
                        </div>
                        <label class="field"><span>이름 설명 (한두 줄, 필수)</span><textarea id="eDesc" maxlength="200" rows="2">${esc(n.description || '')}</textarea></label>
                        <div id="eErr"></div>
                        <div class="btn-row mt">
                          <button class="btn-primary" id="eSave">저장</button>
                          <button id="eCancel">취소</button>
                        </div>
                      </div>
                    </li>`
                  : `<li class="rankrow" style="align-items:flex-start">
                      <div style="flex:1">
                        <div><span class="who">${esc(n.name)}</span> <span class="tag ${n.kind === '한자' ? 'hanja' : 'hangul'}">${esc(n.kind)}</span></div>
                        ${n.english ? `<div class="muted">${esc(n.english)}</div>` : ''}
                        ${n.description ? `<div class="muted">${esc(n.description)}</div>` : ''}
                      </div>
                      <button data-edit="${n.id}">수정</button>
                      <button class="btn-danger" data-del="${n.id}">삭제</button>
                    </li>`,
              )
              .join('')}</ol><div id="pListErr"></div></div>`
          : ''
      }
      ${
        full
          ? `<p class="notice ok mt">이 항목은 이미 ${max}개를 모두 제안했습니다. 마감 전까지는 위 목록에서 수정·삭제할 수 있습니다.</p>`
          : `
      <div class="mt">
        <label class="field"><span>제안할 이름</span><input type="text" id="pName" maxlength="60" placeholder="예: 누리" /></label>
        ${trademarkLinksHtml(null, 'pKipris', 'pWebSearch')}
        <div class="grid-2">
          <label class="field"><span>구분</span>
            <select id="pKind"><option>순수한글</option><option>한자</option></select>
          </label>
          <label class="field"><span>영문 표기 (필수)</span><input type="text" id="pEng" maxlength="80" placeholder="예: Nuri" /></label>
        </div>
        <label class="field"><span>이름 설명 (한두 줄, 필수)</span><textarea id="pDesc" maxlength="200" rows="2" placeholder="이 이름을 제안한 이유나 의미를 간단히 적어주세요"></textarea></label>
        <div id="pErr"></div>
        <button class="btn-primary btn-lg btn-block" id="pSubmit">이 이름 제안하기</button>
      </div>`
      }
      <div class="btn-row mt">
        <button id="pOtherCat">다른 항목 제안하러 가기</button>
        <button id="pDone">항목 목록으로</button>
      </div>
    </div>`;

  document.getElementById('pOtherCat')?.addEventListener('click', goGrid);
  document.getElementById('pDone')?.addEventListener('click', goGrid);

  document.getElementById('pName')?.addEventListener('input', (e) => {
    document.getElementById('pWebSearch').href = webSearchUrl(e.target.value.trim());
  });

  const submitBtn = document.getElementById('pSubmit');
  submitBtn?.addEventListener('click', async () => {
    const name = document.getElementById('pName').value.trim();
    const kind = document.getElementById('pKind').value;
    const english = document.getElementById('pEng').value.trim();
    const description = document.getElementById('pDesc').value.trim();
    const errBox = document.getElementById('pErr');
    if (!name) {
      errBox.innerHTML = `<div class="notice err">이름을 입력하세요.</div>`;
      return;
    }
    if (!english) {
      errBox.innerHTML = `<div class="notice err">영문 표기를 입력하세요.</div>`;
      return;
    }
    if (!description) {
      errBox.innerHTML = `<div class="notice err">이름에 대한 간단한 설명을 입력하세요.</div>`;
      return;
    }
    submitBtn.disabled = true;
    errBox.innerHTML = '';
    try {
      const r = await api('/api/propose', { body: { voterNumber: proposeNumber, categoryId, name, kind, english, description } });
      proposeMine = r.mine;
      renderProposeForm(categoryId);
    } catch (e) {
      errBox.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      submitBtn.disabled = false;
    }
  });

  document.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      editingCandidateId = btn.dataset.edit;
      renderProposeForm(categoryId);
    }),
  );

  document.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await api('/api/propose', {
          method: 'DELETE',
          body: { voterNumber: proposeNumber, categoryId, candidateId: btn.dataset.del },
        });
        proposeMine = r.mine;
        renderProposeForm(categoryId);
      } catch (e) {
        const box = document.getElementById('pListErr');
        if (box) box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
        btn.disabled = false;
      }
    }),
  );

  document.getElementById('eName')?.addEventListener('input', (e) => {
    document.getElementById('eWebSearch').href = webSearchUrl(e.target.value.trim());
  });
  document.getElementById('eCancel')?.addEventListener('click', () => {
    editingCandidateId = null;
    renderProposeForm(categoryId);
  });
  document.getElementById('eSave')?.addEventListener('click', async () => {
    const name = document.getElementById('eName').value.trim();
    const kind = document.getElementById('eKind').value;
    const english = document.getElementById('eEng').value.trim();
    const description = document.getElementById('eDesc').value.trim();
    const errBox = document.getElementById('eErr');
    if (!name) {
      errBox.innerHTML = `<div class="notice err">이름을 입력하세요.</div>`;
      return;
    }
    if (!english) {
      errBox.innerHTML = `<div class="notice err">영문 표기를 입력하세요.</div>`;
      return;
    }
    if (!description) {
      errBox.innerHTML = `<div class="notice err">이름에 대한 간단한 설명을 입력하세요.</div>`;
      return;
    }
    const saveBtn = document.getElementById('eSave');
    saveBtn.disabled = true;
    errBox.innerHTML = '';
    try {
      const r = await api('/api/propose', {
        method: 'PUT',
        body: { voterNumber: proposeNumber, categoryId, candidateId: editingCandidateId, name, kind, english, description },
      });
      proposeMine = r.mine;
      editingCandidateId = null;
      renderProposeForm(categoryId);
    } catch (e) {
      errBox.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      saveBtn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* 투표                                                                */
/* ------------------------------------------------------------------ */
let cat = null; // 현재 투표 중인 항목의 상세(/api/category/:id)
let picked = []; // 선택된 이름 id (선택/순위 순서)
let alloc = {}; // 1차 전용: id -> 배분 점수
let myNumber = null; // 번호 방식일 때 확인된 본인 번호

async function goVote(categoryId) {
  backLink.hidden = false;
  try {
    cat = await api(`/api/category/${categoryId}`);
  } catch (e) {
    view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    return;
  }
  picked = [];
  alloc = {};
  myNumber = null;
  if (!cat.activeRound) return renderClosed(cat);
  if (cat.full) return renderFull(cat);
  if (cat.useVoterNumbers) return renderNumberEntry();
  if (hasVoted(cat.id, cat.activeRound)) return renderAlready();
  renderBallot();
}

function renderNumberEntry() {
  const max = cat.expectedVoters;
  view.innerHTML = `
    <div class="card">
      <h2>${esc(cat.name)} · ${cat.activeRound}차 투표 · 본인 번호 입력</h2>
      <p class="hint">배정받은 <b>본인 번호(1 ~ ${max})</b>를 입력하세요. 번호 하나당 한 번만 투표할 수 있습니다.
        (현재 ${cat.count} / ${max}명 참여)</p>
      <label class="field">
        <span>내 번호</span>
        <input type="number" id="vnum" min="1" max="${max}" inputmode="numeric" class="code-input" placeholder="0" />
      </label>
      <div id="numErr"></div>
      <button class="btn-primary btn-lg btn-block" id="numGo">다음</button>
    </div>`;
  const input = document.getElementById('vnum');
  const go = async () => {
    const n = Number(input.value);
    const errBox = document.getElementById('numErr');
    if (!Number.isInteger(n) || n < 1 || n > max) {
      errBox.innerHTML = `<div class="notice err">1 ~ ${max} 사이 번호를 입력하세요.</div>`;
      return;
    }
    document.getElementById('numGo').disabled = true;
    errBox.innerHTML = '';
    try {
      await api('/api/vote/check', { body: { categoryId: cat.id, voterNumber: n } });
      myNumber = n;
      renderBallot();
    } catch (e) {
      errBox.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      document.getElementById('numGo').disabled = false;
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  document.getElementById('numGo').addEventListener('click', go);
  input.focus();
}

function renderClosed(c) {
  view.innerHTML = `
    <div class="card">
      <h2>${esc(c.name)}</h2>
      <p class="hint">${esc(PHASE_MSG[c.phase] || '현재 투표를 받고 있지 않습니다.')}</p>
    </div>`;
}
function renderFull(c) {
  view.innerHTML = `
    <div class="card">
      <h2>${esc(c.name)} · ${c.activeRound}차 투표 마감</h2>
      <p class="hint">예정된 투표 인원이 모두 참여하여 마감되었습니다. 결과는 <a href="/results">결과 페이지</a>에서 확인하세요.</p>
    </div>`;
}
function renderAlready() {
  view.innerHTML = `
    <div class="card">
      <h2>이미 투표하셨습니다</h2>
      <p class="hint">이 기기에서는 ${cat.activeRound}차 투표가 이미 완료되었습니다. 감사합니다.
        진행 상황은 <a href="/results">결과 페이지</a>에서 볼 수 있습니다.</p>
    </div>`;
}

const isR1 = () => cat.ballot.round === 1;
const budget = () => cat.ballot.tokenBudget || 100;
const allocSum = () => picked.reduce((s, id) => s + (Number(alloc[id]) || 0), 0);
function r2Points(idx) {
  return cat.ballot.points[idx] ?? 0;
}

function renderBallot() {
  const b = cat.ballot;
  const seat =
    cat.expectedVoters > 0
      ? `<span class="tag">${cat.count} / ${cat.expectedVoters}명 참여</span>`
      : `<span class="tag">${cat.count}명 참여</span>`;
  const hint = isR1()
    ? `총 <b>${budget()}점(토큰)</b>을 마음에 드는 이름 <b>최대 ${b.maxPick}개</b>에 자유롭게 나눠 주세요.
       한 이름에 몰아줘도 되고, 골고루 줘도 됩니다. <b>합계가 정확히 ${budget()}점</b>이어야 제출됩니다.`
    : `같은 이름들을 다시 <b>순위대로 최대 ${b.maxPick}개</b> 선택하세요.
       순위에 따라 <b>${b.points.slice(0, b.maxPick).join(' · ')}점</b>이 부여되며, <b>1차 점수와 합산</b>해 최종 순위를 냅니다.
       <br />원하는 만큼만 골라도 됩니다.`;

  const who = myNumber
    ? `<span class="tag">내 번호 ${myNumber}번</span> <a href="#" id="reNum" style="font-size:.85rem">번호 다시 입력</a>`
    : '';
  view.innerHTML = `
    <div class="card">
      <h2>${esc(cat.name)} · ${b.round}차 투표 &nbsp;${seat}</h2>
      <p class="hint">${esc(cat.description)}</p>
      ${who ? `<p style="margin:0 0 8px">${who}</p>` : ''}
      <p class="hint">${hint}</p>
      <div id="rankPanel"></div>
      <div id="candList"></div>
      <div id="submitErr" class="mt"></div>
      <button class="btn-primary btn-lg btn-block mt" id="submit">제출하기</button>
      <p class="hint" style="margin-top:12px">제출 후에는 수정할 수 없습니다. ${
        myNumber ? `${myNumber}번으로 한 번만 투표됩니다.` : '이 기기로는 한 번만 투표할 수 있습니다.'
      }</p>
    </div>`;
  document.getElementById('submit').addEventListener('click', confirmSubmit);
  document.getElementById('reNum')?.addEventListener('click', (e) => {
    e.preventDefault();
    picked = [];
    alloc = {};
    myNumber = null;
    renderNumberEntry();
  });
  paint();
}

function paint() {
  const b = cat.ballot;
  const byId = Object.fromEntries(b.candidates.map((c) => [c.id, c]));
  const panel = document.getElementById('rankPanel');

  if (picked.length === 0) {
    panel.innerHTML = '';
  } else if (isR1()) {
    const sum = allocSum();
    const ok = sum === budget();
    panel.innerHTML = `
      <div class="rankpanel">
        <b>점수 배분 (${picked.length}/${b.maxPick})</b>
        <ol>
          ${picked
            .map(
              (id) => `
            <li class="rankrow">
              <span class="who">${esc(byId[id].name)}</span>
              <input type="number" inputmode="numeric" min="0" max="${budget()}" step="1"
                     value="${alloc[id] ?? 0}" data-alloc="${id}"
                     style="width:88px;text-align:right" />
              <span class="pts">점</span>
              <button data-rm="${id}">✕</button>
            </li>`,
            )
            .join('')}
        </ol>
        <div class="mt" style="font-weight:700;color:${ok ? 'var(--good)' : 'var(--danger)'}">
          합계 ${sum} / ${budget()}점 ${ok ? '✓' : `(${budget() - sum > 0 ? `${budget() - sum}점 남음` : `${sum - budget()}점 초과`})`}
        </div>
      </div>`;
    panel.querySelectorAll('[data-alloc]').forEach((el) => {
      el.addEventListener('input', () => {
        let v = Math.floor(Number(el.value) || 0);
        if (v < 0) v = 0;
        if (v > budget()) v = budget();
        alloc[el.dataset.alloc] = v;
        // 합계 표시만 갱신 (input 포커스 유지 위해 부분 갱신)
        const sum2 = allocSum();
        const okk = sum2 === budget();
        const badge = panel.querySelector('.rankpanel > .mt');
        if (badge) {
          badge.style.color = okk ? 'var(--good)' : 'var(--danger)';
          badge.textContent = `합계 ${sum2} / ${budget()}점 ${okk ? '✓' : sum2 < budget() ? `(${budget() - sum2}점 남음)` : `(${sum2 - budget()}점 초과)`}`;
        }
        document.getElementById('submit').disabled = !(picked.length && sum2 === budget());
      });
    });
    panel.querySelectorAll('[data-rm]').forEach((el) =>
      el.addEventListener('click', () => {
        picked = picked.filter((x) => x !== el.dataset.rm);
        delete alloc[el.dataset.rm];
        paint();
      }),
    );
  } else {
    panel.innerHTML = `
      <div class="rankpanel">
        <b>내 선택 (${picked.length}/${b.maxPick})</b>
        <ol>
          ${picked
            .map(
              (id, i) => `
            <li class="rankrow">
              <span class="pos">${i + 1}순위</span>
              <span class="who">${esc(byId[id].name)}</span>
              <span class="pts">${r2Points(i)}점</span>
              <button data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button data-down="${i}" ${i === picked.length - 1 ? 'disabled' : ''}>▼</button>
              <button data-rm="${id}">✕</button>
            </li>`,
            )
            .join('')}
        </ol>
      </div>`;
    panel.querySelectorAll('[data-up]').forEach((el) => el.addEventListener('click', () => move(+el.dataset.up, -1)));
    panel.querySelectorAll('[data-down]').forEach((el) => el.addEventListener('click', () => move(+el.dataset.down, 1)));
    panel.querySelectorAll('[data-rm]').forEach((el) =>
      el.addEventListener('click', () => {
        picked = picked.filter((x) => x !== el.dataset.rm);
        paint();
      }),
    );
  }

  const list = document.getElementById('candList');
  list.innerHTML = b.candidates
    .map((c) => {
      const idx = picked.indexOf(c.id);
      const isPicked = idx >= 0;
      const full = picked.length >= b.maxPick;
      const badge = isR1() ? `${alloc[c.id] ?? 0}점` : idx + 1;
      return `
      <div class="cand ${isPicked ? 'picked' : ''}">
        <div>
          <span class="name">${esc(c.name)}</span>${c.english ? `<span class="eng">${esc(c.english)}</span>` : ''}
          <span class="tag ${c.kind === '한자' ? 'hanja' : 'hangul'}">${esc(c.kind)}</span>
          ${c.description ? `<div class="muted">${esc(c.description)}</div>` : ''}
        </div>
        <div class="right">
          ${
            isPicked
              ? `<span class="rankbadge" data-unpick="${c.id}" title="선택 취소" style="cursor:pointer;${isR1() ? 'width:auto;padding:0 10px;border-radius:14px' : ''}">${badge}</span>`
              : `<button class="pickbtn" data-pick="${c.id}" ${full ? 'disabled' : ''}>선택</button>`
          }
        </div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-pick]').forEach((el) =>
    el.addEventListener('click', () => {
      if (picked.length < b.maxPick) {
        picked.push(el.dataset.pick);
        if (isR1() && alloc[el.dataset.pick] == null) alloc[el.dataset.pick] = 0;
      }
      paint();
    }),
  );
  list.querySelectorAll('[data-unpick]').forEach((el) =>
    el.addEventListener('click', () => {
      picked = picked.filter((x) => x !== el.dataset.unpick);
      delete alloc[el.dataset.unpick];
      paint();
    }),
  );

  document.getElementById('submit').disabled = isR1()
    ? !(picked.length && allocSum() === budget())
    : picked.length === 0;
}

function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= picked.length) return;
  [picked[i], picked[j]] = [picked[j], picked[i]];
  paint();
}

function confirmSubmit() {
  const byId = Object.fromEntries(cat.ballot.candidates.map((c) => [c.id, c]));
  let summary;
  if (isR1()) {
    if (allocSum() !== budget()) return;
    summary = picked.map((id) => `${byId[id].name}: ${alloc[id] || 0}점`).join('\n') + `\n(합계 ${allocSum()}점)`;
  } else {
    summary = picked.map((id, i) => `${i + 1}순위: ${byId[id].name} (${r2Points(i)}점)`).join('\n');
  }
  const head = myNumber ? `${myNumber}번으로 제출합니다.\n\n` : '';
  if (!window.confirm(`${head}${summary}\n\n제출 후에는 수정할 수 없습니다.`)) return;
  submit();
}

async function submit() {
  const btn = document.getElementById('submit');
  const err = document.getElementById('submitErr');
  btn.disabled = true;
  err.innerHTML = '';
  const body = { categoryId: cat.id, voterKey: voterKey() };
  if (myNumber) body.voterNumber = myNumber;
  if (isR1()) body.allocations = picked.map((id) => ({ id, points: Number(alloc[id]) || 0 }));
  else body.ranking = picked;
  try {
    await api('/api/vote/submit', { body });
    if (!myNumber) markVoted(cat.id, cat.ballot.round);
    renderDone();
  } catch (e) {
    err.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function renderDone() {
  const byId = Object.fromEntries(cat.ballot.candidates.map((c) => [c.id, c]));
  const rows = isR1()
    ? picked.map((id) => `<li class="rankrow"><span class="who">${esc(byId[id].name)}</span><span class="pts">${alloc[id] || 0}점</span></li>`)
    : picked.map(
        (id, i) => `<li class="rankrow"><span class="pos">${i + 1}순위</span>
        <span class="who">${esc(byId[id].name)}</span><span class="pts">${r2Points(i)}점</span></li>`,
      );
  view.innerHTML = `
    <div class="card">
      <h2>✅ ${esc(cat.name)} · 투표가 완료되었습니다</h2>
      <p class="hint">소중한 한 표 감사합니다. ${myNumber ? `${myNumber}번은 다시 투표할 수 없습니다.` : '이 기기에서는 다시 투표할 수 없습니다.'}</p>
      <div class="rankpanel"><b>제출한 내용</b><ol>${rows.join('')}</ol></div>
      <p class="hint mt">최종 선정된 이름에는 상금이 수여됩니다. 결과는 <a href="/results">결과 페이지</a>에서 공개됩니다.</p>
    </div>`;
}
