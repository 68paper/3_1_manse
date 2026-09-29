/*
 * js/ui.js — 화면 그리기 · 이벤트 연결
 * ------------------------------------------------------------------
 * solo.js(진행) · art.js(그림) · engine.js(판정, solo.js를 통해서만 접근)를
 * 가져다 DOM에 그리고, 탭 입력을 solo.js의 행동 함수로 그대로 넘긴다.
 */
import {
  SoloGame, PIECE_NAME, PIECE_ORDER,
  makePracticeLevel,
  requestPersistentStorage, getSettings, setSettings,
  getCampaignProgress, saveCampaignResult, isLevelUnlocked
} from './solo.js';
import { Engine } from './engine.js';
import {
  taegeukgiFlag, taegeukIcon, trigramIcon, dieIcon, lanternIcon, pieceIcon
} from './art.js';
import { Sound } from './audio.js';

// 화면에 보이는 무리 이름(규칙 보기와 같은 이름). 엔진의 TYPE_NAME은 판정용 설명이다.
const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };

// ------------------------------------------------------------------
// 전역 상태
// ------------------------------------------------------------------
const state = {
  campaignLevels: [],
  levelsById: {},
  game: null,
  level: null,
  mode: null, // 'practice' | 'campaign'
  returnScreen: 'title',
  settings: getSettings(),
  dawnPending: []
};

const PROVINCES = [
  { key: 'gyeonggi', name: '경기도', open: true },
  { key: 'gangwon', name: '강원도', open: false },
  { key: 'chungcheong', name: '충청도', open: false },
  { key: 'jeolla', name: '전라도', open: false },
  { key: 'gyeongsang', name: '경상도', open: false },
  { key: 'hwanghae', name: '황해도', open: false },
  { key: 'pyeongan', name: '평안도', open: false },
  { key: 'hamgyeong', name: '함경도', open: false }
];

// ------------------------------------------------------------------
// 화면 전환
// ------------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (el) {
    el.classList.toggle('active', el.dataset.screen === name);
  });
  document.getElementById('overlay-panel').hidden = true;
  document.getElementById('mission-modal').hidden = true;
  window.scrollTo(0, 0);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove('show'); }, 1600);
}

// ------------------------------------------------------------------
// 타이틀
// ------------------------------------------------------------------
function renderTitleFlag() {
  document.getElementById('title-flag').innerHTML = taegeukgiFlag(240);
}

// ------------------------------------------------------------------
// 팔도 캠페인 — 지도
// ------------------------------------------------------------------
function renderProvinceGrid() {
  const wrap = document.getElementById('province-grid');
  wrap.innerHTML = PROVINCES.map(function (p) {
    return '<button class="province-btn" data-province="' + p.key + '" ' + (p.open ? '' : 'disabled') + '>' +
      '<div class="name">' + p.name + '</div>' +
      '<div class="status">' + (p.open ? '입장 가능' : '준비 중') + '</div>' +
      '</button>';
  }).join('');
}

// ------------------------------------------------------------------
// 팔도 캠페인 — 단계 목록
// ------------------------------------------------------------------
function renderCampaignList() {
  const list = document.getElementById('campaign-level-list');
  const progress = getCampaignProgress();
  list.innerHTML = state.campaignLevels.map(function (lv, idx) {
    const unlocked = isLevelUnlocked(state.campaignLevels, lv.id);
    const rec = progress[lv.id];
    const stars = rec ? rec.stars : 0;
    const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    return '<button class="level-row' + (unlocked ? '' : ' locked') + '" data-level="' + lv.id + '" ' + (unlocked ? '' : 'disabled') + '>' +
      '<div class="num">' + (idx + 1) + '</div>' +
      '<div class="info"><div class="t">' + lv.title + '</div><div class="m">' + (lv.tutorial ? '안내 단계' : (lv.nights + '밤')) + (rec ? ' · 최고 ' + rec.bestScore + '점' : '') + '</div></div>' +
      '<div class="stars">' + (unlocked ? starStr : '🔒') + '</div>' +
      '</button>';
  }).join('');
}

// ------------------------------------------------------------------
// 규칙 보기
// ------------------------------------------------------------------
function renderRules() {
  const el = document.getElementById('rules-content');
  const dice = function (color, value) { return dieIcon(color, value, 34); };
  el.innerHTML = `
    <div class="rules-block">
      <h3>어떻게 하나요</h3>
      <p>여덟 밤 동안, 밤마다 나오는 주사위 중 두 개를 골라 나의 3×3 지방 판에 놓습니다. 판이 비어 있으면 어디든, 그 뒤로는 이미 놓인 주사위(감시의 눈 포함)의 상하좌우 빈칸에만 놓을 수 있어요.</p>
    </div>
    <div class="rules-block">
      <h3>세 가지 무리</h3>
      <p>가로나 세로 한 줄이 채워지면 무리를 이루는지 살펴봐요. (대각선은 해당 없음)</p>
      <div class="combo-example"><div class="dice">${dice('red', 4)}${dice('black', 4)}${dice('white', 4)}</div><div><b>한뜻</b> — 눈이 같고 색이 모두 다름 · 조각 2개</div></div>
      <div class="combo-example"><div class="dice">${dice('blue', 3)}${dice('blue', 4)}${dice('blue', 5)}</div><div><b>연락망</b> — 색이 같고 눈이 연속(2·3·4 / 3·4·5 / 4·5·6) · 조각 2개</div></div>
      <div class="combo-example"><div class="dice">${dice('white', 2)}${dice('white', 5)}${dice('white', 6)}</div><div><b>한동네</b> — 색이 같고 눈이 서로 다름(연속 아님) · 조각 1개</div></div>
      <p class="muted">무리를 이루면 한 사람만 남기고 나머지는 주머니로 돌아가요. 받는 조각은 태극·건·리·감·곤 중 원하는 대로 고를 수 있어요.</p>
    </div>
    <div class="rules-block">
      <h3>감시의 눈</h3>
      <div class="combo-example"><div class="dice">${dice('white', 1)}</div><div>감시의 눈은 무리를 이루지 못해요. 하지만 자리(배치 기준)로는 쓸 수 있어요.</div></div>
      <p>감시의 눈이 섞인 줄이 가득 차면 <b>흩어져요</b>: 감시의 눈은 남고 나머지 주사위만 주머니로 돌아가요. 감시의 눈 셋으로만 채워진 줄은 <b>감시 철수</b>로 셋 모두 돌아가요. 한뜻을 이루면 판 위의 감시의 눈을 하나 밀어낼 수 있어요.</p>
    </div>
    <div class="rules-block">
      <h3>점수와 태극기</h3>
      <p>점수 = 모은 조각 수 + 완성한 태극기 수. 태극·건·리·감·곤을 한 벌씩 모으면 태극기 한 장이 완성돼요. 여덟 번째 밤이 끝나면(등잔이 다 꺼지면) 그날 밤이 마무리돼요.</p>
    </div>
    <div class="rules-block">
      <h3>두 가지 놀이 방법</h3>
      <p><b>팔도 캠페인</b> — 지역별로 이어지는 단계. 별을 모아 다음 단계를 열어요.<br>
      <b>자유 연습</b> — 매번 새로운 밤으로 마음껏 연습해요.</p>
    </div>
  `;
}

// ------------------------------------------------------------------
// 설정
// ------------------------------------------------------------------
function renderSettings() {
  document.getElementById('toggle-hints').checked = !!state.settings.hints;
  document.getElementById('toggle-bgm').checked = state.settings.bgm !== false;
  document.getElementById('toggle-sfx').checked = state.settings.sfx !== false;
}

function applySoundSettings() {
  Sound.configure({ bgm: state.settings.bgm !== false, sfx: state.settings.sfx !== false });
}

// ------------------------------------------------------------------
// 게임 화면 — 시작
// ------------------------------------------------------------------
function startGame(level, mode) {
  state.level = level;
  state.mode = mode;
  state.game = new SoloGame(level, mode, {});
  state.returnScreen = mode === 'campaign' ? 'campaign-list' : 'title';
  showScreen('game');
  renderGame();
}

function currentHintsEnabled() {
  return !!state.settings.hints;
}

// ------------------------------------------------------------------
// 게임 화면 — 그리기
// ------------------------------------------------------------------
function renderGame() {
  const g = state.game;
  const snap = g.snapshot();

  // 등잔
  const lanternsEl = document.getElementById('lanterns');
  let lanternHtml = '';
  for (let i = 0; i < snap.maxNights; i++) {
    const lit = !snap.done && (i + 1) >= snap.night;
    lanternHtml += '<div class="lantern-slot">' + lanternIcon(22, lit) + '</div>';
  }
  lanternsEl.innerHTML = lanternHtml;

  document.getElementById('score-badge').textContent = snap.score + '점';
  document.getElementById('game-message').textContent = snap.message;

  renderMission(g, snap);

  // 판
  const boardEl = document.getElementById('board');
  const showScatterHint = currentHintsEnabled() && snap.phase === 'place' && snap.selectedPi != null;
  let boardHtml = '';
  for (let i = 0; i < 9; i++) {
    const die = snap.board[i];
    const classes = ['cell'];
    if (snap.phase === 'place' && snap.selectedPi != null && snap.validCells.indexOf(i) >= 0) {
      classes.push('valid');
      if (showScatterHint && g.wouldScatterAt(snap.selectedPi, i)) classes.push('scatter-warn');
    }
    if (snap.phase === 'combo_keep' && snap.keepLine && snap.keepLine.indexOf(i) >= 0) classes.push('choosable');
    if ((snap.phase === 'combo_eye' || snap.phase === 'blocked_eye') && snap.eyeOptions && snap.eyeOptions.indexOf(i) >= 0) classes.push('choosable');
    boardHtml += '<div class="' + classes.join(' ') + '" data-cell="' + i + '">' + (die ? dieIcon(die.color, die.value, 50) : '') + '</div>';
  }
  boardEl.innerHTML = boardHtml;

  // 풀
  const poolEl = document.getElementById('pool');
  const poolClickable = snap.phase === 'place' || snap.phase === 'blocked_pool';
  poolEl.innerHTML = snap.pool.map(function (d, i) {
    const sel = snap.phase === 'place' && snap.selectedPi === i ? ' selected' : '';
    return '<button class="die-btn' + sel + '" data-pi="' + i + '" ' + (poolClickable ? '' : 'disabled') + '>' + dieIcon(d.color, d.value, 54, { selected: snap.selectedPi === i }) + '</button>';
  }).join('');
  document.getElementById('placements-left').textContent = snap.done ? '' : ('이번 밤 남은 배치: ' + snap.placementsLeft + '번 · ' + snap.night + '/' + snap.maxNights + '번째 밤');

  // 기록지
  renderRecordSheet(snap.parts, snap.flags);

  // 오버레이(무리 순서 · 조각 고르기)
  const overlay = document.getElementById('overlay-panel');
  if (snap.phase === 'combo_order') {
    overlay.hidden = false;
    overlay.innerHTML = '<p>' + snap.message + '</p><div class="opt-row">' + snap.comboOrderOptions.map(function (o) {
      return '<button data-combo-order="' + o.idx + '">' + Engine.TYPE_NAME[o.type] + '</button>';
    }).join('') + '</div>';
  } else if (snap.phase === 'combo_reward') {
    overlay.hidden = false;
    overlay.innerHTML = '<p>' + snap.message + '</p><div class="opt-row">' + snap.rewardOptions.map(function (key) {
      return '<button class="piece-btn" data-reward="' + key + '"><span class="ic">' + pieceIcon(key, 28, true) + '</span>' + PIECE_NAME[key] + '</button>';
    }).join('') + '</div>';
  } else {
    overlay.hidden = true;
  }

  if (snap.done) {
    setTimeout(goToDawn, 450);
  }
}

// 캠페인 미션 카드: 별1 목표의 진행 · 별 기준 · 단계 안내
function renderMission(g, snap) {
  const el = document.getElementById('mission');
  if (state.mode !== 'campaign') { el.hidden = true; return; }
  const level = state.level;
  const p = g.goalProgress();
  const stars = level.stars || [];

  let goal, prog;
  if (p.type === 'flags') { goal = '태극기 ' + p.target + '장 완성'; prog = p.current + '/' + p.target; }
  else if (p.type === 'combo') { goal = COMBO_NAME[p.combo] + ' ' + p.target + '번 이루기'; prog = p.current + '/' + p.target; }
  else if (p.type === 'noScatter') { goal = '흩어짐 없이 마치기'; prog = p.met ? '' : '흩어짐 ' + p.current + '번'; }
  else { goal = p.target + '점 이상'; prog = p.current + '/' + p.target; }
  // noScatter는 끝나야 달성이 확정되고, 한 번 흩어지면 실패가 확정된다.
  const met = p.type === 'noScatter' ? (snap.done && p.met) : p.met;
  const failed = p.type === 'noScatter' && !p.met;


  const steps = [
    { label: '★ 미션', on: met },
    stars.length > 1 ? { label: '★★ ' + stars[1] + '점', on: snap.score >= stars[1] } : null,
    stars.length > 2 ? { label: '★★★ ' + stars[2] + '점', on: snap.score >= stars[2] } : null
  ].filter(Boolean);

  const hasHelp = !!(level.intro || (level.tips && level.tips.length));
  let html = '<div class="mission-head">' +
    '<span class="tag">' + (met ? '달성' : '미션') + '</span>' +
    '<span class="goal">' + goal + (prog ? '<span class="prog">' + prog + '</span>' : '') + '</span>' +
    (hasHelp ? '<button class="help-btn" id="mission-help" aria-haspopup="dialog" aria-label="미션 설명 보기">?</button>' : '') +
    '</div>' +
    '<div class="star-steps">' + steps.map(function (s) { return '<span' + (s.on ? ' class="on"' : '') + '>' + s.label + '</span>'; }).join('') + '</div>';
  el.innerHTML = html;
  el.classList.toggle('met', met);
  el.classList.toggle('failed', failed);
  el.classList.toggle('has-help', hasHelp);
  el.hidden = false;
}

// 미션 설명 팝업: 단계 이름 · 목표 · 별 기준 · 안내(intro · tips)
function openMissionModal() {
  const level = state.level;
  if (!level) return;
  const idx = state.campaignLevels.findIndex(function (l) { return l.id === level.id; });
  document.getElementById('mission-modal-title').textContent = (idx >= 0 ? (idx + 1) + '단계 · ' : '') + level.title;
  document.getElementById('mission-modal-goal').textContent = goalDescription(level);
  document.getElementById('mission-modal-body').innerHTML = (level.intro ? '<p>' + level.intro + '</p>' : '') +
    (level.tips && level.tips.length ? '<ul>' + level.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' : '');
  document.getElementById('mission-modal').hidden = false;
  document.getElementById('mission-modal-close').focus();
}

function closeMissionModal() {
  document.getElementById('mission-modal').hidden = true;
}

function renderRecordSheet(parts, flagsDone) {
  const el = document.getElementById('record-sheet');
  const counts = Object.assign({}, parts);
  const rows = [];
  let rowIdx = 0;
  while (rowIdx < flagsDone || (rowIdx === flagsDone && PIECE_ORDER.some(function (k) { return counts[k] > 0; }))) {
    const row = PIECE_ORDER.map(function (k) {
      if (counts[k] > 0) { counts[k]--; return { key: k, filled: true }; }
      return { key: k, filled: false };
    });
    rows.push(row);
    rowIdx++;
    if (rowIdx >= flagsDone && !PIECE_ORDER.some(function (k) { return counts[k] > 0; })) break;
    if (rowIdx > 6) break;
  }
  if (rows.length === 0) rows.push(PIECE_ORDER.map(function (k) { return { key: k, filled: false }; }));
  let html = rows.map(function (row, i) {
    return '<div class="record-row"><div class="flag-num">' + (i + 1) + '</div><div class="icons">' +
      row.map(function (c) { return pieceIcon(c.key, 26, c.filled); }).join('') +
      '</div></div>';
  }).join('');
  const overflow = PIECE_ORDER.reduce(function (s, k) { return s + counts[k]; }, 0);
  if (overflow > 0) html += '<div class="overflow-row">+넘친 조각 ' + overflow + '개</div>';
  el.innerHTML = html;
}

// ------------------------------------------------------------------
// 게임 화면 — 효과음
// ------------------------------------------------------------------
// 행동 전후의 기록을 비교해 무슨 일이 일어났는지에 맞는 북 장단을 고른다.
function soundState() {
  const g = state.game;
  return {
    stats: Object.assign({}, g.g.players[0].stats),
    pieces: g.pieces, flags: g.flags, night: g.night, done: g.done
  };
}

function playActionSounds(before) {
  const after = soundState();
  const b = before.stats, a = after.stats;
  const changed = ['placements', 'same', 'consec', 'color', 'scatterLines', 'withdrawn', 'blocked', 'eyesRemoved']
    .some(function (k) { return a[k] !== b[k]; }) || after.pieces !== before.pieces || after.night !== before.night;
  if (!changed) { Sound.play('select'); return; } // 남길 사람 고르기 등
  if (a.placements > b.placements) Sound.play('place');
  // 놓은 소리 뒤에 이어서 결과 소리를 친다.
  const d = a.placements > b.placements ? 0.18 : 0;
  if (after.flags > before.flags) Sound.play('flag', d);
  else if (after.pieces > before.pieces) Sound.play('reward', d);
  if (a.same + a.consec + a.color > b.same + b.consec + b.color) Sound.play('combo', d);
  if (a.scatterLines > b.scatterLines) Sound.play('scatter', d);
  if (a.withdrawn > b.withdrawn) Sound.play('withdraw', d);
  if (a.blocked > b.blocked) Sound.play('blocked', d);
  if (a.eyesRemoved > b.eyesRemoved) Sound.play('eye', d);
  if (!after.done && after.night > before.night) Sound.play('night', d + 0.5);
}

// ------------------------------------------------------------------
// 게임 화면 — 입력
// ------------------------------------------------------------------
function onBoardClick(cell) {
  const g = state.game;
  const snap = g.snapshot();
  const before = soundState();
  if (snap.phase === 'place') {
    if (snap.selectedPi == null) return;
    if (snap.validCells.indexOf(cell) < 0) return;
    g.placeAt(cell);
  } else if (snap.phase === 'combo_keep') {
    if (!snap.keepLine || snap.keepLine.indexOf(cell) < 0) return;
    g.chooseKeep(cell);
  } else if (snap.phase === 'combo_eye') {
    if (!snap.eyeOptions || snap.eyeOptions.indexOf(cell) < 0) return;
    g.chooseEye(cell);
  } else if (snap.phase === 'blocked_eye') {
    if (!snap.eyeOptions || snap.eyeOptions.indexOf(cell) < 0) return;
    g.removeBlockedEye(cell);
  } else {
    return;
  }
  playActionSounds(before);
  renderGame();
}

function onPoolClick(pi) {
  const g = state.game;
  const snap = g.snapshot();
  const before = soundState();
  if (snap.phase === 'place') {
    g.selectDie(pi);
    Sound.play('select');
  } else if (snap.phase === 'blocked_pool') {
    g.resolveBlockedPool(pi);
    playActionSounds(before);
  } else {
    return;
  }
  renderGame();
}

function onOverlayClick(target) {
  const g = state.game;
  const before = soundState();
  if (target.dataset.comboOrder != null) {
    g.chooseComboOrder(Number(target.dataset.comboOrder));
    playActionSounds(before);
    renderGame();
  } else if (target.dataset.reward != null) {
    g.chooseReward(target.dataset.reward);
    playActionSounds(before);
    renderGame();
  }
}

// ------------------------------------------------------------------
// 새벽(결과) 화면
// ------------------------------------------------------------------
function goToDawn() {
  const g = state.game;
  const level = state.level;
  const stars = g.starsEarned();
  if (state.mode === 'campaign') saveCampaignResult(level.id, stars, g.score);

  showScreen('dawn');
  Sound.play('dawn');
  document.getElementById('dawn-result').hidden = true;
  document.getElementById('dawn-skip').hidden = false;
  const sky = document.getElementById('dawn-sky');
  sky.style.background = '#141a2b';
  document.getElementById('dawn-caption').textContent = '여덟 번째 등잔이 꺼졌습니다.';
  setTimeout(function () { sky.style.background = 'linear-gradient(180deg, #b98763, #ebb866, #f8ecd2)'; }, 120);

  const taegeukCount = g.parts.taegeuk;
  state.dawnPending = [];
  const paintArea = document.getElementById('dawn-paint-area');
  if (taegeukCount > 0) {
    let html = '';
    for (let i = 0; i < taegeukCount; i++) {
      html += '<button class="paint-btn" data-paint="' + i + '">' + taegeukIcon(48, false) + '</button>';
      state.dawnPending.push(i);
    }
    paintArea.innerHTML = html;
  } else {
    paintArea.innerHTML = '';
    showDawnResult();
  }
}

function onPaintClick(target) {
  const idx = target.dataset.paint;
  if (target.classList.contains('painted')) return;
  target.classList.add('painted');
  target.innerHTML = taegeukIcon(48, true);
  Sound.play('reward');
  state.dawnPending = state.dawnPending.filter(function (i) { return String(i) !== idx; });
  if (state.dawnPending.length === 0) {
    setTimeout(showDawnResult, 250);
  }
}

function showDawnResult() {
  document.getElementById('dawn-skip').hidden = true;
  const g = state.game;
  const level = state.level;
  const stars = g.starsEarned();

  document.getElementById('dawn-score-line').textContent = g.score + '점 · 태극기 ' + g.flags + '장';

  const starsLineEl = document.getElementById('dawn-stars-line');
  const goalLineEl = document.getElementById('dawn-goal-line');
  if (state.mode === 'campaign') {
    starsLineEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    starsLineEl.hidden = false;
    goalLineEl.textContent = goalDescription(level);
    goalLineEl.hidden = false;
  } else {
    starsLineEl.hidden = true;
    goalLineEl.hidden = true;
  }

  const nextBtn = document.getElementById('btn-dawn-next');
  if (state.mode === 'campaign') {
    const idx = state.campaignLevels.findIndex(function (l) { return l.id === level.id; });
    const next = state.campaignLevels[idx + 1];
    if (next && stars >= 1) {
      nextBtn.hidden = false;
      nextBtn.onclick = function () { startGame(next, 'campaign'); };
    } else {
      nextBtn.hidden = true;
    }
  } else {
    nextBtn.hidden = true;
  }

  document.getElementById('dawn-result').hidden = false;
}

function goalDescription(level) {
  const goal = level.goal || { type: 'score' };
  const stars = level.stars || [];
  let g;
  if (goal.type === 'flags') g = '목표: 태극기 ' + (goal.count || 1) + '장';
  else if (goal.type === 'combo') g = '목표: ' + COMBO_NAME[goal.combo] + ' ' + (goal.count || 1) + '회';
  else if (goal.type === 'noScatter') g = '목표: 흩어짐 없이 마치기';
  else g = '목표: 점수 ' + (stars[0] || 1) + '점 이상';
  if (stars.length >= 3) g += ' · ★' + stars[0] + ' ★★' + stars[1] + ' ★★★' + stars[2];
  return g;
}

// ------------------------------------------------------------------
// 초기화 · 이벤트 연결
// ------------------------------------------------------------------
function wireStaticEvents() {
  document.body.addEventListener('click', function (e) {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      Sound.play('tap');
      const target = nav.dataset.nav;
      if (target === 'campaign-list') renderCampaignList();
      if (target === 'rules') renderRules();
      if (target === 'settings') renderSettings();
      if (target === 'practice-start') { startGame(makePracticeLevel(), 'practice'); return; }
      showScreen(target);
      return;
    }
    const province = e.target.closest('[data-province]');
    if (province && !province.disabled) {
      renderCampaignList();
      showScreen('campaign-list');
      return;
    }
    const levelBtn = e.target.closest('[data-level]');
    if (levelBtn && !levelBtn.disabled) {
      const lv = state.levelsById[levelBtn.dataset.level];
      if (lv) startGame(lv, 'campaign');
      return;
    }
    if (e.target.closest('#mission.has-help')) { Sound.play('tap'); openMissionModal(); return; }
    if (e.target.closest('#mission-modal-close') || e.target.id === 'mission-modal') { closeMissionModal(); return; }
    const cell = e.target.closest('#board .cell');
    if (cell) { onBoardClick(Number(cell.dataset.cell)); return; }
    const dieBtn = e.target.closest('#pool .die-btn');
    if (dieBtn) { onPoolClick(Number(dieBtn.dataset.pi)); return; }
    const overlayBtn = e.target.closest('#overlay-panel button');
    if (overlayBtn) { onOverlayClick(overlayBtn); return; }
    const paintBtn = e.target.closest('#dawn-paint-area .paint-btn');
    if (paintBtn) { onPaintClick(paintBtn); return; }
  });

  document.getElementById('btn-game-exit').addEventListener('click', function () {
    if (confirm('지금 나가면 이번 밤의 진행은 저장되지 않아요. 나가시겠어요?')) {
      showScreen(state.returnScreen === 'campaign-list' ? 'campaign-list' : 'title');
      if (state.returnScreen === 'campaign-list') renderCampaignList();
    }
  });

  document.getElementById('dawn-skip').addEventListener('click', function () {
    document.querySelectorAll('#dawn-paint-area .paint-btn:not(.painted)').forEach(function (btn) {
      btn.classList.add('painted');
      btn.innerHTML = taegeukIcon(48, true);
    });
    state.dawnPending = [];
    showDawnResult();
  });

  document.getElementById('btn-dawn-again').addEventListener('click', function () {
    if (state.mode === 'practice') startGame(makePracticeLevel(), 'practice');
    else startGame(state.level, 'campaign');
  });

  document.getElementById('btn-dawn-home').addEventListener('click', function () {
    showScreen('title');
  });

  document.getElementById('toggle-hints').addEventListener('change', function (e) {
    state.settings = setSettings({ hints: e.target.checked }) || state.settings;
  });
  document.getElementById('toggle-bgm').addEventListener('change', function (e) {
    state.settings = setSettings({ bgm: e.target.checked }) || state.settings;
    applySoundSettings();
  });
  document.getElementById('toggle-sfx').addEventListener('change', function (e) {
    state.settings = setSettings({ sfx: e.target.checked }) || state.settings;
    applySoundSettings();
  });

  // 자동재생 정책: 첫 터치/클릭 때 소리를 켠다. 앱이 가려지면 배경음을 멈춘다.
  document.addEventListener('pointerdown', function () { Sound.unlock(); }, { capture: true });
  document.addEventListener('keydown', function (e) {
    Sound.unlock();
    if (e.key === 'Escape') closeMissionModal();
  }, { capture: true });
  document.addEventListener('visibilitychange', function () { Sound.setHidden(document.hidden); });
}

async function loadLevels() {
  const res = await fetch('data/levels.json');
  const levels = await res.json();
  state.campaignLevels = levels;
  levels.forEach(function (lv) { state.levelsById[lv.id] = lv; });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 무시: 오프라인 캐시는 선택 사항 */ });
  }
}

async function init() {
  requestPersistentStorage();
  applySoundSettings();
  renderTitleFlag();
  renderProvinceGrid();
  wireStaticEvents();
  showScreen('title');
  try { await loadLevels(); } catch (e) { /* 목록이 없어도 자유 연습은 동작 */ }
  registerServiceWorker();
}

init();
