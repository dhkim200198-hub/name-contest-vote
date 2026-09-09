import { api, esc, won } from '/api.js';

const view = document.getElementById('view');

const PHASE_MSG = {
  prep: '아직 투표가 시작되지 않았습니다. 잠시 후 다시 확인해 주세요.',
  round1_closed: '1차 투표가 마감되었습니다. 2차 투표 안내를 기다려 주세요.',
  round2_closed: '2차 투표가 마감되었습니다. 곧 최종 결과가 발표됩니다.',
  done: '공모전이 종료되었습니다. 결과 페이지에서 최종 선정된 이름을 확인하세요.',
};

// 이 브라우저의 익명 식별자 (중복 투표 방지용, 서버로만 전송)
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
let picked = []; // 선택된 이름 id (순위 순서)

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
    if (hasVoted(st.activeRound)) return renderAlready(st.activeRound);
    picked = [];
    renderBallot();
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

function pointsFor(rankIdx) {
  return st.ballot.points[rankIdx] ?? 0;
}

function renderBallot() {
  const b = st.ballot;
  const total = b.points.slice(0, b.maxPick).reduce((a, c) => a + c, 0);
  const seat =
    st.expectedVoters > 0
      ? `<span class="tag">${st.count} / ${st.expectedVoters}명 참여</span>`
      : `<span class="tag">${st.count}명 참여</span>`;
  view.innerHTML = `
    <div class="card">
      <h2>${b.round}차 투표 &nbsp;${seat}</h2>
      <p class="hint">
        ${
          b.round === 1
            ? `마음에 드는 이름을 <b>순위대로 최대 ${b.maxPick}개</b> 선택하세요. 순위에 따라 <b>${b.points
                .slice(0, b.maxPick)
                .join(' · ')}점</b>(총 ${total}점)이 부여됩니다.`
            : `같은 이름들을 다시 <b>순위대로 최대 ${b.maxPick}개</b> 선택하세요. 순위에 따라 <b>${b.points
                .slice(0, b.maxPick)
                .join(' · ')}점</b>이 부여되며, <b>1차 점수와 합산</b>해 최종 순위를 냅니다.`
        }
        <br />원하는 만큼만 골라도 됩니다.
      </p>
      <div id="rankPanel"></div>
      <div id="candList"></div>
      <div id="submitErr" class="mt"></div>
      <button class="btn-primary btn-lg btn-block mt" id="submit">제출하기</button>
      <p class="hint" style="margin-top:12px">제출 후에는 수정할 수 없습니다. 이 기기로는 한 번만 투표할 수 있습니다.</p>
    </div>`;
  document.getElementById('submit').addEventListener('click', confirmSubmit);
  paint();
}

function paint() {
  const b = st.ballot;
  const byId = Object.fromEntries(b.candidates.map((c) => [c.id, c]));

  const panel = document.getElementById('rankPanel');
  if (picked.length === 0) {
    panel.innerHTML = '';
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
              <span class="pts">${pointsFor(i)}점</span>
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
      const rank = picked.indexOf(c.id);
      const isPicked = rank >= 0;
      const full = picked.length >= b.maxPick;
      return `
      <div class="cand ${isPicked ? 'picked' : ''}">
        <div>
          <span class="name">${esc(c.name)}</span>${c.english ? `<span class="eng">${esc(c.english)}</span>` : ''}
          <span class="tag ${c.kind === '한자' ? 'hanja' : 'hangul'}">${esc(c.kind)}</span>
        </div>
        <div class="right">
          ${
            isPicked
              ? `<span class="rankbadge" data-unpick="${c.id}" title="선택 취소" style="cursor:pointer">${rank + 1}</span>`
              : `<button class="pickbtn" data-pick="${c.id}" ${full ? 'disabled' : ''}>선택</button>`
          }
        </div>
        ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-pick]').forEach((el) =>
    el.addEventListener('click', () => {
      if (picked.length < b.maxPick) picked.push(el.dataset.pick);
      paint();
    }),
  );
  list.querySelectorAll('[data-unpick]').forEach((el) =>
    el.addEventListener('click', () => {
      picked = picked.filter((x) => x !== el.dataset.unpick);
      paint();
    }),
  );

  document.getElementById('submit').disabled = picked.length === 0;
}

function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= picked.length) return;
  [picked[i], picked[j]] = [picked[j], picked[i]];
  paint();
}

function confirmSubmit() {
  const byId = Object.fromEntries(st.ballot.candidates.map((c) => [c.id, c]));
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
    await api('/api/vote/submit', { body: { round: st.ballot.round, ranking: picked, voterKey: voterKey() } });
    markVoted(st.ballot.round);
    renderDone();
  } catch (e) {
    err.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function renderDone() {
  const byId = Object.fromEntries(st.ballot.candidates.map((c) => [c.id, c]));
  view.innerHTML = `
    <div class="card">
      <h2>✅ 투표가 완료되었습니다</h2>
      <p class="hint">소중한 한 표 감사합니다. 이 기기에서는 다시 투표할 수 없습니다.</p>
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
