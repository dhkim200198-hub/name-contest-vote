import { api, esc, won } from '/api.js';

const view = document.getElementById('view');

const PHASE_MSG = {
  prep: '아직 투표가 시작되지 않았습니다. 잠시 후 다시 확인해 주세요.',
  round1_closed: '1차 투표가 마감되었습니다. 2차 투표 안내를 기다려 주세요.',
  round2_closed: '2차 투표가 마감되었습니다. 곧 최종 결과가 발표됩니다.',
  done: '공모전이 종료되었습니다. 결과 페이지에서 최종 선정된 이름을 확인하세요.',
};

let ballot = null; // { round, candidates, maxPick, weights|points }
let code = '';
let picked = []; // 선택된 후보 id (순위 순서대로)

init();

async function init() {
  try {
    const st = await api('/api/state');
    document.getElementById('title').textContent = st.title;
    document.getElementById('subtitle').textContent = st.subtitle || '';
    if (st.prize > 0) {
      document.getElementById('prizeAmt').textContent = won(st.prize);
      document.getElementById('prize').hidden = false;
    }
    if (st.activeRound) renderCodeEntry(st.activeRound, st);
    else renderClosed(st.phase);
  } catch (e) {
    view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
  }
}

function renderClosed(phase) {
  view.innerHTML = `
    <div class="card">
      <h2>진행 중인 투표가 없습니다</h2>
      <p class="hint">${esc(PHASE_MSG[phase] || '현재 투표를 받고 있지 않습니다.')}</p>
    </div>`;
}

function renderCodeEntry(round, st) {
  const scheme =
    round === 1
      ? `1차 투표입니다. 마음에 드는 이름을 <b>순위대로 최대 ${st.round1.weights.length}개</b> 고르면
         순위에 따라 <b>${st.round1.weights.join(' · ')}점</b>이 부여됩니다.`
      : `2차 투표입니다. 같은 이름들을 다시 <b>순위대로</b> 고르면
         순위에 따라 <b>${st.round2.points.join(' · ')}점</b>이 부여됩니다. (1차 점수와 합산해 최종 순위를 냅니다)`;
  view.innerHTML = `
    <div class="card">
      <h2>${round}차 투표 · 코드 입력</h2>
      <p class="hint">${scheme}</p>
      <label class="field">
        <span>투표 코드 (예: ABCD-2345)</span>
        <input class="code-input" id="code" autocomplete="off" spellcheck="false"
               inputmode="text" placeholder="────────" maxlength="9" />
      </label>
      <div id="codeErr"></div>
      <button class="btn-primary btn-lg btn-block" id="go">투표 시작</button>
      <p class="hint" style="margin-top:14px">
        코드는 1인당 1개이며, 한 번 사용하면 다시 쓸 수 없습니다.
      </p>
    </div>`;

  const input = document.getElementById('code');
  input.addEventListener('input', () => {
    let v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4, 8);
    input.value = v;
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && start());
  document.getElementById('go').addEventListener('click', start);
  input.focus();
}

async function start() {
  const err = document.getElementById('codeErr');
  const btn = document.getElementById('go');
  code = document.getElementById('code').value.trim();
  if (!code) {
    err.innerHTML = `<div class="notice err">코드를 입력하세요.</div>`;
    return;
  }
  btn.disabled = true;
  err.innerHTML = '';
  try {
    const res = await api('/api/vote/check', { body: { code } });
    ballot = res;
    picked = [];
    renderBallot();
  } catch (e) {
    err.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function pointsFor(rankIdx) {
  const arr = ballot.round === 1 ? ballot.weights : ballot.points;
  return arr[rankIdx] ?? 0;
}

function renderBallot() {
  const total = ballot.round === 1 ? ballot.weights.reduce((a, b) => a + b, 0) : null;
  view.innerHTML = `
    <div class="card">
      <h2>${ballot.round}차 투표 · 후보 선택</h2>
      <p class="hint">
        ${
          ballot.round === 1
            ? `아래에서 <b>최대 ${ballot.maxPick}개</b>를 선택한 순서대로 순위가 매겨집니다.
               (총 ${total}점: ${ballot.weights.join(' · ')})`
            : `아래 이름들을 <b>최대 ${ballot.maxPick}개</b> 선택한 순서대로 순위가 매겨집니다.
               (순위별 ${ballot.points.join(' · ')}점 · 1차 결과와 합산)`
        }
        <br />원하는 만큼만 골라도 됩니다.
      </p>

      <div id="rankPanel"></div>
      <div id="candList"></div>
      <div id="submitErr" class="mt"></div>
      <button class="btn-primary btn-lg btn-block mt" id="submit">제출하기</button>
    </div>`;
  document.getElementById('submit').addEventListener('click', confirmSubmit);
  paint();
}

function paint() {
  // 순위 패널
  const panel = document.getElementById('rankPanel');
  if (picked.length === 0) {
    panel.innerHTML = '';
  } else {
    const byId = Object.fromEntries(ballot.candidates.map((c) => [c.id, c]));
    panel.innerHTML = `
      <div class="rankpanel">
        <b>내 선택 (${picked.length}/${ballot.maxPick})</b>
        <ol>
          ${picked
            .map(
              (id, i) => `
            <li class="rankrow">
              <span class="pos">${i + 1}순위</span>
              <span class="who">${esc(byId[id].name)}</span>
              <span class="pts">${pointsFor(i)}점</span>
              <button data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button data-down="${i}" ${i === picked.length - 1 ? 'disabled' : ''}>▼</button>
              <button data-rm="${id}">✕</button>
            </li>`,
            )
            .join('')}
        </ol>
      </div>`;
    panel.querySelectorAll('[data-up]').forEach((b) =>
      b.addEventListener('click', () => move(+b.dataset.up, -1)),
    );
    panel.querySelectorAll('[data-down]').forEach((b) =>
      b.addEventListener('click', () => move(+b.dataset.down, 1)),
    );
    panel.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => {
        picked = picked.filter((x) => x !== b.dataset.rm);
        paint();
      }),
    );
  }

  // 후보 목록
  const list = document.getElementById('candList');
  list.innerHTML = ballot.candidates
    .map((c) => {
      const rank = picked.indexOf(c.id);
      const isPicked = rank >= 0;
      const full = picked.length >= ballot.maxPick;
      return `
      <div class="cand ${isPicked ? 'picked' : ''}">
        <div>
          <span class="name">${esc(c.name)}</span>${c.english ? `<span class="eng">${esc(c.english)}</span>` : ''}
          <span class="tag ${c.kind === '한자' ? 'hanja' : 'hangul'}">${esc(c.kind)}</span>
        </div>
        <div class="right">
          ${
            isPicked
              ? `<span class="rankbadge">${rank + 1}</span>`
              : `<button class="pickbtn" data-pick="${c.id}" ${full ? 'disabled' : ''}>선택</button>`
          }
        </div>
        ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      if (picked.length < ballot.maxPick) picked.push(b.dataset.pick);
      paint();
    }),
  );
  list.querySelectorAll('.cand.picked .rankbadge').forEach((el, i) => {
    el.style.cursor = 'pointer';
    el.title = '선택 취소';
    el.addEventListener('click', () => {
      picked.splice(i, 1);
      paint();
    });
  });

  document.getElementById('submit').disabled = picked.length === 0;
}

function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= picked.length) return;
  [picked[i], picked[j]] = [picked[j], picked[i]];
  paint();
}

function confirmSubmit() {
  const byId = Object.fromEntries(ballot.candidates.map((c) => [c.id, c]));
  const summary = picked.map((id, i) => `${i + 1}순위: ${byId[id].name} (${pointsFor(i)}점)`).join('\n');
  if (!window.confirm(`아래 내용으로 제출합니다.\n\n${summary}\n\n제출 후에는 수정할 수 없습니다.`)) return;
  submit();
}

async function submit() {
  const btn = document.getElementById('submit');
  const err = document.getElementById('submitErr');
  btn.disabled = true;
  err.innerHTML = '';
  try {
    await api('/api/vote/submit', { body: { code, ranking: picked } });
    renderDone();
  } catch (e) {
    err.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function renderDone() {
  const byId = Object.fromEntries(ballot.candidates.map((c) => [c.id, c]));
  view.innerHTML = `
    <div class="card">
      <h2>✅ 투표가 완료되었습니다</h2>
      <p class="hint">소중한 한 표 감사합니다. 이 코드는 더 이상 사용할 수 없습니다.</p>
      <div class="rankpanel">
        <b>제출한 내용</b>
        <ol>
          ${picked
            .map(
              (id, i) => `<li class="rankrow"><span class="pos">${i + 1}순위</span>
              <span class="who">${esc(byId[id].name)}</span><span class="pts">${pointsFor(i)}점</span></li>`,
            )
            .join('')}
        </ol>
      </div>
      <p class="hint mt">최종 선정된 이름에는 상금이 수여됩니다. 결과는 <a href="/results">결과 페이지</a>에서 공개됩니다.</p>
    </div>`;
}
