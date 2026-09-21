import { api, esc, won } from '/api.js';

const view = document.getElementById('view');
let data = null;
let activeCat = location.hash ? location.hash.slice(1) : null;

load();
setInterval(load, 15000);

const PHASE_LABEL = {
  prep: '준비 중',
  round1_open: '1차 투표 진행 중',
  round1_closed: '1차 투표 마감',
  round2_open: '2차 투표 진행 중',
  round2_closed: '2차 투표 마감',
  done: '최종 발표',
};

const d1 = (n) => Math.round(Number(n || 0) * 10) / 10;

async function load() {
  try {
    data = await api('/api/results');
    if (!activeCat || !data.categories.some((c) => c.id === activeCat)) {
      activeCat = data.categories[0]?.id || null;
    }
    render();
  } catch (e) {
    view.innerHTML = `<div class="card"><h2>결과를 불러올 수 없습니다</h2><p class="hint">${esc(e.message)}</p></div>`;
  }
}

function roundTable(section) {
  const scheme =
    section.tokenBudget != null
      ? `토큰 ${section.tokenBudget}점 / 최대 ${section.maxPicks}개`
      : (section.points || []).join(' · ') + '점';
  return `
    <div class="grid-2 mt">
      <div class="stat"><div class="k">투표 수</div><div class="v">${section.totalBallots}${
        section.expectedVoters ? ` / ${section.expectedVoters}` : ''
      }</div></div>
      <div class="stat"><div class="k">방식</div><div class="v" style="font-size:1rem">${scheme}</div></div>
    </div>
    <div class="table-scroll mt">
      <table class="data">
        <thead><tr><th>순위</th><th>이름</th><th>영문</th><th class="num">점수</th><th class="num">${
          section.tokenBudget != null ? '최고배점' : '1순위표'
        }</th></tr></thead>
        <tbody>
          ${section.rows
            .map(
              (x) => `<tr class="${x.rank === 1 ? 'top1' : ''}">
              <td class="num">${x.rank}</td><td>${esc(x.name)}</td><td class="muted">${esc(x.english || '')}</td>
              <td class="num">${d1(x.score)}</td><td class="num">${x.firsts}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function renderCategory(r) {
  if (!r.public) {
    return `<div class="card">
      <p class="muted">현재 단계: <b>${PHASE_LABEL[r.phase] || r.phase}</b></p>
      <h2>아직 결과가 공개되지 않았습니다</h2>
      <p class="hint">이 항목의 결과는 아직 비공개입니다. 투표가 마감되면 공개됩니다.</p>
    </div>`;
  }

  const cr = r.combineRatio || { round1: 1, round2: 1 };
  const ratioTxt = cr.round1 === cr.round2 ? '1 : 1 (동일)' : `${cr.round1} : ${cr.round2}`;
  let html = `<p class="muted">현재 단계: <b>${PHASE_LABEL[r.phase] || r.phase}</b></p>`;

  if (r.winner && r.phase === 'done') {
    const w = r.winner;
    html += `
      <div class="card" style="border-color:var(--gold)">
        <div class="eyebrow" style="color:var(--gold)">최종 선정 (1·2차 종합)</div>
        <h2 style="font-size:1.8rem;margin:.2em 0">${esc(w.name)}
          ${w.english ? `<span class="cand"><span class="eng">${esc(w.english)}</span></span>` : ''}</h2>
        <p class="hint">종합 ${d1(w.score)}점 · 🏆 상금 <b>${won(r.prize)}</b> 수여 대상입니다.</p>
      </div>`;
  }

  html += `<div class="card">
    <h2>종합 순위 (1차 + 2차)</h2>
    <p class="hint">각 라운드를 <b>100점 만점으로 환산</b>한 뒤 <b>${ratioTxt}</b> 비율로 합산합니다. (아래 1·2차 표의 "점수"는 환산 전 원점수)</p>
    <div class="table-scroll mt">
      <table class="data">
        <thead><tr><th>순위</th><th>이름</th><th>영문</th><th class="num">1차(환산)</th><th class="num">2차(환산)</th><th class="num">종합</th></tr></thead>
        <tbody>${r.combined
          .map(
            (x) => `<tr class="${x.rank === 1 ? 'top1' : ''}">
            <td class="num">${x.rank}</td><td>${esc(x.name)}</td><td class="muted">${esc(x.english || '')}</td>
            <td class="num">${d1(x.round1Score)}</td><td class="num">${d1(x.round2Score)}</td>
            <td class="num"><b>${d1(x.score)}</b></td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>
  </div>`;

  html += `<div class="card"><h2>1차 투표 (토큰 자유 배분)</h2>${roundTable(r.round1)}</div>`;
  html += `<div class="card"><h2>2차 투표 (순위별 점수)</h2>${roundTable(r.round2)}</div>`;
  return html;
}

function render() {
  document.getElementById('title').textContent = `${data.title} · 결과`;
  const tabs = `<div class="tabs">
    ${data.categories
      .map((c) => `<button data-cat="${c.id}" class="${c.id === activeCat ? 'active' : ''}">${esc(c.name)}</button>`)
      .join('')}
  </div>`;
  const cur = data.categories.find((c) => c.id === activeCat);
  view.innerHTML = `${tabs}<div id="catBody">${cur ? renderCategory(cur) : ''}</div>
    <p class="muted" style="font-size:.82rem">15초마다 자동 새로고침됩니다.</p>`;
  view.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => {
      activeCat = b.dataset.cat;
      location.hash = activeCat;
      render();
    }),
  );
}
