import { api, esc, won } from '/api.js';

const view = document.getElementById('view');

const PHASE_MSG = {
  prep: '아직 투표가 시작되지 않았습니다. 잠시 후 다시 확인해 주세요.',
  round1_closed: '1차 투표가 마감되었습니다. 2차 투표 안내를 기다려 주세요.',
  round2_closed: '2차 투표가 마감되었습니다. 곧 최종 결과가 발표됩니다.',
  done: '공모전이 종료되었습니다. 결과 페이지에서 최종 선정된 이름을 확인하세요.',
};

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
function markVoted(round) {
  try {
    localStorage.setItem(`voted_round${round}`, new Date().toISOString());
  } catch {
    /* ignore */
  }
}
function hasVoted(round) {
  try {
    return !!localStorage.getItem(`voted_round${round}`);
  } catch {
    return false;
  }
}

let st = null;
let picked = []; // 선택된 이름 id (선택/순위 순서)
let alloc = {}; // 1차 전용: id -> 배분 점수
let myNumber = null; // 번호 방식일 때 확인된 본인 번호

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
    if (!st.activeRound) return renderClosed(st.phase);
    if (st.full) return renderFull(st.activeRound);
    picked = [];
    alloc = {};
    if (st.useVoterNumbers) {
      myNumber = null;
      return renderNumberEntry();
    }
    if (hasVoted(st.activeRound)) return renderAlready(st.activeRound);
    renderBallot();
  } catch (e) {
    view.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
  }
}

function renderNumberEntry() {
  const max = st.expectedVoters;
  view.innerHTML = `
    <div class="card">
      <h2>${st.activeRound}차 투표 · 본인 번호 입력</h2>
      <p class="hint">배정받은 <b>본인 번호(1 ~ ${max})</b>를 입력하세요. 번호 하나당 한 번만 투표할 수 있습니다.
        (현재 ${st.count} / ${max}명 참여)</p>
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
      await api('/api/vote/check', { body: { voterNumber: n } });
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

function renderClosed(phase) {
  view.innerHTML = `
    <div class="card">
      <h2>진행 중인 투표가 없습니다</h2>
      <p class="hint">${esc(PHASE_MSG[phase] || '현재 투표를 받고 있지 않습니다.')}</p>
    </div>`;
}
function renderFull(round) {
  view.innerHTML = `
    <div class="card">
      <h2>${round}차 투표 마감</h2>
      <p class="hint">예정된 투표 인원이 모두 참여하여 마감되었습니다. 결과는 <a href="/results">결과 페이지</a>에서 확인하세요.</p>
    </div>`;
}
function renderAlready(round) {
  view.innerHTML = `
    <div class="card">
      <h2>이미 투표하셨습니다</h2>
      <p class="hint">이 기기에서는 ${round}차 투표가 이미 완료되었습니다. 감사합니다.
        진행 상황은 <a href="/results">결과 페이지</a>에서 볼 수 있습니다.</p>
    </div>`;
}

const isR1 = () => st.ballot.round === 1;
const budget = () => st.ballot.tokenBudget || 100;
const allocSum = () => picked.reduce((s, id) => s + (Number(alloc[id]) || 0), 0);
function r2Points(idx) {
  return st.ballot.points[idx] ?? 0;
}

function renderBallot() {
  const b = st.ballot;
  const seat =
    st.expectedVoters > 0
      ? `<span class="tag">${st.count} / ${st.expectedVoters}명 참여</span>`
      : `<span class="tag">${st.count}명 참여</span>`;
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
      <h2>${b.round}차 투표 &nbsp;${seat}</h2>
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
  const b = st.ballot;
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
        </div>
        <div class="right">
          ${
            isPicked
              ? `<span class="rankbadge" data-unpick="${c.id}" title="선택 취소" style="cursor:pointer;${isR1() ? 'width:auto;padding:0 10px;border-radius:14px' : ''}">${badge}</span>`
              : `<button class="pickbtn" data-pick="${c.id}" ${full ? 'disabled' : ''}>선택</button>`
          }
        </div>
        ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}
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
  const byId = Object.fromEntries(st.ballot.candidates.map((c) => [c.id, c]));
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
  const body = { voterKey: voterKey() };
  if (myNumber) body.voterNumber = myNumber;
  if (isR1()) body.allocations = picked.map((id) => ({ id, points: Number(alloc[id]) || 0 }));
  else body.ranking = picked;
  try {
    await api('/api/vote/submit', { body });
    if (!myNumber) markVoted(st.ballot.round);
    renderDone();
  } catch (e) {
    err.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function renderDone() {
  const byId = Object.fromEntries(st.ballot.candidates.map((c) => [c.id, c]));
  const rows = isR1()
    ? picked.map((id) => `<li class="rankrow"><span class="who">${esc(byId[id].name)}</span><span class="pts">${alloc[id] || 0}점</span></li>`)
    : picked.map(
        (id, i) => `<li class="rankrow"><span class="pos">${i + 1}순위</span>
        <span class="who">${esc(byId[id].name)}</span><span class="pts">${r2Points(i)}점</span></li>`,
      );
  view.innerHTML = `
    <div class="card">
      <h2>✅ 투표가 완료되었습니다</h2>
      <p class="hint">소중한 한 표 감사합니다. ${myNumber ? `${myNumber}번은 다시 투표할 수 없습니다.` : '이 기기에서는 다시 투표할 수 없습니다.'}</p>
      <div class="rankpanel"><b>제출한 내용</b><ol>${rows.join('')}</ol></div>
      <p class="hint mt">최종 선정된 이름에는 상금이 수여됩니다. 결과는 <a href="/results">결과 페이지</a>에서 공개됩니다.</p>
    </div>`;
}
