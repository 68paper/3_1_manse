/*
 * js/ui.js — 화면 그리기 · 이벤트 연결
 * ------------------------------------------------------------------
 * solo.js · multi.js(진행) · art.js(그림) · engine.js(판정, solo.js를 통해서만 접근)를
 * 가져다 DOM에 그리고, 탭 입력을 solo.js의 행동 함수로 그대로 넘긴다.
 */
import {
  SoloGame, PIECE_NAME, PIECE_ORDER,
  makePracticeLevel, makeEndlessLevel, saveEndlessResult,
  requestPersistentStorage, getSettings, setSettings,
  getCampaignProgress, saveCampaignResult, isLevelUnlocked,
  getPracticeSetup, savePracticeSetup, getSavedNames, addSavedNames
} from './solo.js';
import { MultiGame } from './multi.js';
import { Engine } from './engine.js';
import {
  taegeukgiFlag, trigramIcon, dieIcon, lanternIcon, pieceIcon
} from './art.js';
import { Sound } from './audio.js';
import { PROLOGUE, NIGHT_STORIES, MARCH_FIRST, nightDate, latestStory } from './story.js';

// 화면에 보이는 모둠 이름(규칙 보기와 같은 이름). 엔진의 TYPE_NAME은 판정용 설명이다.
const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };
// 자유 연습: 자리(지방)마다 점수판 말 색
const PAWN_COLORS = ['#c8312f', '#1f4e9a', '#3f7d4e', '#d9962b', '#7b4d8f'];

// ------------------------------------------------------------------
// 전역 상태
// ------------------------------------------------------------------
const state = {
  campaignLevels: [],
  levelsById: {},
  game: null,
  level: null,
  mode: null, // 'practice' | 'campaign' | 'endless'
  returnScreen: 'title',
  settings: getSettings(),
  dawnPending: [],
  practiceSetup: getPracticeSetup(), // 자유 연습 자리 구성(인원 · 사람/AI · 이름)
  practiceSeats: null,               // 이번 판에 실제로 앉은 자리(다시 하기용)
  aiTimer: null,
  lastTurnId: null,
  dawnFor: null,                       // 새벽 화면을 이미 예약한 판(두 번 가지 않도록)
  pulseCell: null,                     // 방금 주사위를 놓은 칸(한 번만 튕기는 연출)
  track: { game: null, shown: {}, timer: null } // 점수판: 말이 지금 서 있는 칸(한 칸씩 걸어가게)
};

// ------------------------------------------------------------------
// 화면 전환
// ------------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (el) {
    el.classList.toggle('active', el.dataset.screen === name);
  });
  document.getElementById('overlay-panel').hidden = true;
  document.getElementById('info-modal').hidden = true;
  clearTimeout(state.aiTimer);
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
// 게임 익히기 — 단계 목록(타이틀에서 바로 들어온다)
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

// 주사위 속 사람들(룰북 v1.1): 색마다 어떤 사람들이 모였는지, 눈 2~6이 누구인지
const DICE_PEOPLE = [
  { color: 'white', group: '흰색 — 마을과 장터 사람들', names: ['젊은 여성', '마을 어른', '보부상', '아낙', '농부'] },
  { color: 'black', group: '검정 — 도시의 일하는 사람들', names: ['상인', '인력거꾼', '인쇄공', '기생', '노동자'] },
  { color: 'red', group: '빨강 — 학생과 젊은이들', names: ['여학생', '남학생', '교사', '단발 학생', '소년'] },
  { color: 'blue', group: '파랑 — 신앙의 사람들', names: ['천도교 도인', '목사', '승려', '전도부인', '젊은 교인'] }
];

// ------------------------------------------------------------------
// 규칙 보기
// ------------------------------------------------------------------
function renderRules() {
  const el = document.getElementById('rules-content');
  const dice = function (color, value) { return dieIcon(color, value, 34); };
  const peopleHtml = DICE_PEOPLE.map(function (g) {
    return '<h4 class="people-group">' + g.group + '</h4><div class="people-row">' + g.names.map(function (n, i) {
      return '<figure>' + dieIcon(g.color, i + 2, 44) + '<figcaption>' + n + '</figcaption></figure>';
    }).join('') + '</div>';
  }).join('') +
    '<div class="combo-example"><div class="dice">' + dieIcon('black', 1, 44) + '</div><div><b>모든 색의 1 — 밀정</b><br>검은 중절모와 외투 차림으로 사람들 사이에 숨어 지켜보는 감시자예요.</div></div>';
  el.innerHTML = `
    <div class="rules-block">
      <h3>게임 소개</h3>
      <p>여러분은 한 지방에서 삼일운동을 준비하는 <b>조직가</b>예요. 밤마다 찾아오는 사람들에게 알맞은 자리를 찾아 주세요. 뜻이 맞는 세 사람이 한 줄에 서면 <b>모둠</b>이 되고, 모둠은 <b>태극기 조각</b>을 찍어요. 여덟 밤 동안 조각을 모아 태극기를 완성하며 3월 1일 아침을 향해 나아가요.</p>
    </div>
    <div class="rules-block">
      <h3>사람 주사위</h3>
      <p>주사위 하나하나가 그날 찾아온 <b>사람</b>이에요. <b>색</b>은 어떤 사람들이 모였는지를, <b>눈</b>은 그 사람이 찍어 낼 수 있는 조각을 뜻해요.</p>
      <p class="muted">흰색 마을과 장터 사람들 · 검정 도시의 일하는 사람들 · 빨강 학생과 젊은이들 · 파랑 신앙의 사람들<br>
      눈 2 태극 · 3 건 · 4 리 · 5 감 · 6 곤 — 눈의 크고 작음은 순서일 뿐, 누가 더 높거나 강한 사람이 아니에요.</p>
      <div class="combo-example"><div class="dice">${dice('white', 1)}${dice('red', 1)}</div><div><b>1은 밀정</b>이에요. 사람들 사이에 섞여 든 감시자라서 어떤 모둠에도 들어갈 수 없어요.</div></div>
    </div>
    <div class="rules-block">
      <h3>한 밤의 흐름</h3>
      <p>밤마다 주머니에서 주사위를 꺼내 굴려 <b>광장</b>에 둬요. 광장에서 주사위 <b>1개</b>를 골라 내 판에 놓고, 모둠이나 흩어짐을 처리한 뒤 <b>한 번 더</b> 골라 놓아요.</p>
      <p><b>가져간 주사위는 반드시 놓아야 해요.</b> 찾아온 사람을 돌려보내지 않아요. 밀정이 섞여 있어도, 흩어질 줄 알면서도 받아들여요. 여덟 번째 밤이 끝나면(등잔이 다 꺼지면) 3월 1일 아침이 밝아요.</p>
    </div>
    <div class="rules-block">
      <h3>자리 찾아 주기</h3>
      <p>판이 비어 있으면 어느 칸에든, 그 뒤로는 이미 놓인 주사위의 <b>상하좌우 빈칸</b>에만 놓을 수 있어요(대각선은 안 돼요). 밀정 옆 빈칸에도 놓을 수 있어요.</p>
    </div>
    <div class="rules-block">
      <h3>세 가지 모둠</h3>
      <p>가로나 세로 한 줄이 주사위 3개로 가득 차는 순간, 모둠이 되는지 살펴봐요. (대각선은 해당 없음)</p>
      <div class="combo-example"><div class="dice">${dice('red', 4)}${dice('black', 4)}${dice('white', 4)}</div><div><b>한뜻</b> — 눈이 모두 같고 색이 모두 다름 · 내 판의 밀정 1개 쫓아내기(+1점) + 원하는 조각 2개</div></div>
      <div class="combo-example"><div class="dice">${dice('blue', 3)}${dice('blue', 4)}${dice('blue', 5)}</div><div><b>연락망</b> — 색이 모두 같고 눈이 이어짐(2·3·4 / 3·4·5 / 4·5·6) · 원하는 조각 2개</div></div>
      <div class="combo-example"><div class="dice">${dice('white', 2)}${dice('white', 5)}${dice('white', 6)}</div><div><b>한동네</b> — 색이 모두 같고 눈이 모두 다름(이어지지 않음) · 원하는 조각 1개</div></div>
      <p class="muted">밀정이 하나라도 있는 줄은 모둠이 될 수 없어요. 같은 색이고 눈이 이어지면 연락망만 받아요. 조각은 태극·건·리·감·곤 중 무엇이든 고를 수 있고, 같은 조각을 여러 개 골라도 돼요.</p>
    </div>
    <div class="rules-block">
      <h3>모둠을 이루면</h3>
      <ol class="rules-steps">
        <li><b>한 사람을 남겨요.</b> 모둠의 세 주사위 중 1개는 판에 남고 2개는 주머니로 돌아가요. 남은 사람이 다음 모둠의 씨앗이에요.</li>
        <li><b>밀정을 쫓아내요.</b> (한뜻만) 내 판 어디에 있든 밀정 하나를 골라 돌려보내고 <b>1점</b>을 받아요. 판에 밀정이 없으면 건너뛰어요.</li>
        <li><b>조각을 받아요.</b> 조각 하나에 1점이에요.</li>
      </ol>
      <p><b>교차 완성</b> — 주사위 하나로 가로줄과 세로줄이 동시에 모둠이 되면, 방금 놓은 주사위가 남고 나머지 4개는 돌아가요. 두 모둠의 보상을 모두 받고, 받는 순서는 직접 정해요.</p>
    </div>
    <div class="rules-block">
      <h3>흩어짐과 감시 철수</h3>
      <div class="combo-example"><div class="dice">${dice('blue', 2)}${dice('black', 1)}${dice('white', 6)}</div><div>가득 찼는데 모둠이 아닌 줄은 <b>흩어져요</b>. 밀정은 판에 남고 나머지만 주머니로 돌아가요.</div></div>
      <p>밀정 셋으로만 찬 줄은 <b>감시 철수</b>로 셋 모두 돌아가요. 감시 철수로 빠진 밀정에는 점수가 없어요.</p>
      <p class="muted">처리 순서: 모둠 → 흩어짐 → 감시 철수. 모둠에서 남긴 주사위가 걸친 다른 줄이 가득 차 있으면, 그 줄이 흩어지며 남긴 주사위도 함께 돌아가요. 남길 사람을 고를 때 살펴보세요.</p>
    </div>
    <div class="rules-block">
      <h3>점수와 태극기</h3>
      <p>점수 = <b>찍은 조각 수 + 완성한 태극기 장수 + 밀정을 쫓아낸 횟수</b>. 태극·건·리·감·곤 다섯 자리가 모두 찍히면 태극기 한 장이 완성되고, 그때 1점을 더 받아요.</p>
      <p class="muted">예) 태극 2 · 건 1 · 리 1 · 감 1 · 곤 1을 모으고 밀정을 한 번 쫓아냈다면 6 + 1 + 1 = 8점</p>
      <p><b>스무하루의 밤</b>은 1919년 2월 8일부터 2월 28일까지 스물한 밤이에요. 밤마다 그 무렵 3·1 운동을 준비하던 이야기가 펼쳐지고, 끝까지 버티면 3월 1일 새벽을 맞아요. 그 전에 가로 세 줄과 세로 세 줄 모두에 밀정이 자리 잡으면 <b>판이 막혀</b> 끝나요. 언제든 종료 버튼으로 그때까지의 점수를 기록하고 마칠 수도 있어요.</p>
    </div>
    <div class="rules-block">
      <h3>세 가지 놀이 방법</h3>
      <p><b>게임 익히기</b> — 미션을 하나씩 풀며 규칙을 익혀요. 별을 모아 다음 단계를 열어요.<br>
      <b>스무하루의 밤</b> — 2·8 독립선언부터 3월 1일 새벽까지, 이야기와 함께 스물한 밤을 버텨요.<br>
      <b>자유 연습</b> — 3~5명이 AI나 친구와 함께 여덟 밤을 겨뤄요. 친구와는 한 기기를 돌려 가며 둬요.</p>
      <p class="muted">여럿이 할 때는 밤마다 광장에 (인원×2+2)개를 꺼내요. 점수판 「3월 1일로 가는 길」에서 가장 뒤에 있는 사람부터 차례로 고르고, 같은 칸에 말이 쌓여 있으면 아래에 깔린 말이 먼저 골라요. 순서는 밤을 시작할 때 정해져 밤 도중에는 바뀌지 않아요. 여덟 밤 뒤 가장 앞선 사람이 이기고, 같은 칸이면 위에 올라선 말(나중에 도착한 말)이 앞서요.</p>
    </div>
    <div class="rules-block">
      <h3>주사위 속 사람들</h3>
      <p class="muted">그날을 준비한 사람들은 저마다 처지가 달랐어요. 마을에서, 도시에서, 학교에서, 예배당과 절에서 사람들이 스스로 찾아왔어요.</p>
      ${peopleHtml}
    </div>
  `;
}

// ------------------------------------------------------------------
// 자유 연습 — 자리 구성(인원 3~5 · 사람/AI · 이름)
// ------------------------------------------------------------------
function renderPracticeSetup() {
  const setup = state.practiceSetup;
  document.querySelectorAll('#setup-count button').forEach(function (b) {
    b.classList.toggle('on', Number(b.dataset.count) === setup.count);
  });
  let aiNo = 0;
  document.getElementById('setup-seats').innerHTML = setup.seats.slice(0, setup.count).map(function (s, i) {
    const human = s.type === 'human';
    if (!human) aiNo++;
    return '<div class="seat-row">' +
      '<span class="seat-no">' + (i + 1) + '</span>' +
      '<div class="seg small">' +
        '<button data-seat="' + i + '" data-seat-type="human" class="' + (human ? 'on' : '') + '">플레이어</button>' +
        '<button data-seat="' + i + '" data-seat-type="ai" class="' + (human ? '' : 'on') + '">AI</button>' +
      '</div>' +
      (human
        ? '<input class="seat-name" data-seat-name="' + i + '" maxlength="8" list="saved-names" placeholder="플레이어 ' + (i + 1) + '" value="' + escapeHtml(s.name || '') + '" autocomplete="off">'
        : '<span class="seat-ai">AI ' + aiNo + '</span>') +
      '</div>';
  }).join('');
  document.getElementById('saved-names').innerHTML = getSavedNames().map(function (n) {
    return '<option value="' + escapeHtml(n) + '"></option>';
  }).join('');
  const humans = setup.seats.slice(0, setup.count).filter(function (s) { return s.type === 'human'; }).length;
  document.getElementById('btn-practice-start').disabled = humans === 0;
  document.getElementById('setup-hint').textContent = humans === 0 ? '플레이어를 한 명 이상 넣어 주세요.' :
    (humans > 1 ? '사람끼리는 한 기기를 돌려 가며 둬요. 차례가 바뀌면 알려 드려요.' : '');
}

/** 설정 화면 값 → 실제 자리 목록. 빈 이름은 '플레이어 N', AI는 'AI 1'부터 */
function practiceSeatsFromSetup() {
  const setup = state.practiceSetup;
  let aiNo = 0;
  return setup.seats.slice(0, setup.count).map(function (s, i) {
    if (s.type === 'ai') { aiNo++; return { type: 'ai', name: 'AI ' + aiNo }; }
    return { type: 'human', name: (s.name || '').trim() || '플레이어 ' + (i + 1) };
  });
}

function startPractice() {
  const seats = practiceSeatsFromSetup();
  savePracticeSetup(state.practiceSetup);
  const typed = state.practiceSetup.seats.slice(0, state.practiceSetup.count)
    .filter(function (s) { return s.type === 'human' && (s.name || '').trim(); })
    .map(function (s) { return s.name.trim(); });
  if (typed.length) addSavedNames(typed);
  state.practiceSeats = seats;
  startGame(makePracticeLevel(), 'practice', seats);
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
function startGame(level, mode, seats) {
  clearTimeout(state.aiTimer);
  state.level = level;
  state.mode = mode;
  state.game = mode === 'practice' ? new MultiGame(level, seats) : new SoloGame(level, mode, {});
  state.lastTurnId = null;
  state.pulseCell = null;
  clearTimeout(state.track.timer); state.track.timer = null; state.track.game = null;
  state.returnScreen = mode === 'campaign' ? 'campaign-list' : 'title';
  // 스무하루의 밤은 ← 대신 '종료'(점수 기록 후 끝내기)
  document.getElementById('btn-game-exit').hidden = mode === 'endless';
  document.getElementById('btn-game-quit').hidden = mode !== 'endless';
  document.getElementById('score-badge').hidden = mode === 'practice'; // 여럿일 때는 아래 점수 줄로
  showScreen('game');
  document.getElementById('story-panel').dataset.night = '';
  renderGame();
  if (mode === 'campaign') openMissionModal(); // 단계 시작 때 미션 설명을 먼저 보여 준다
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
  if (state.mode === 'endless') {
    lanternHtml = '<div class="lantern-slot">' + lanternIcon(22, !snap.done) + '</div>' +
      '<button class="night-count" id="btn-night-story" aria-label="이번 밤 이야기로 이동">' + nightDate(snap.night) + ' <span class="n">' + snap.night + '/' + snap.maxNights + '</span></button>';
  }
  for (let i = 0; state.mode !== 'endless' && i < snap.maxNights; i++) {
    const lit = !snap.done && (i + 1) >= snap.night;
    lanternHtml += '<div class="lantern-slot">' + lanternIcon(22, lit) + '</div>';
  }
  lanternsEl.innerHTML = lanternHtml;

  document.getElementById('score-badge').textContent = snap.score + '점';
  document.getElementById('game-message').textContent = snap.message;
  renderPlayersBar(snap);
  renderScoreTrack(snap);

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
    if (state.pulseCell === i) classes.push('pulse');
    boardHtml += '<div class="' + classes.join(' ') + '" data-cell="' + i + '">' + (die ? dieIcon(die.color, die.value, 50) : '') + '</div>';
  }
  boardEl.innerHTML = boardHtml;
  state.pulseCell = null; // 튕김은 놓은 직후 한 번만

  // 풀
  const poolEl = document.getElementById('pool');
  const poolClickable = !snap.isAiTurn && (snap.phase === 'place' || snap.phase === 'blocked_pool');
  poolEl.innerHTML = snap.pool.map(function (d, i) {
    const sel = snap.phase === 'place' && snap.selectedPi === i ? ' selected' : '';
    return '<button class="die-btn' + sel + '" data-pi="' + i + '" ' + (poolClickable ? '' : 'disabled') + '>' + dieIcon(d.color, d.value, 54, { selected: snap.selectedPi === i }) + '</button>';
  }).join('');
  const nightLabel = state.mode === 'endless' ? nightDate(snap.night) + ' 밤' : snap.night + '/' + snap.maxNights + '번째 밤';
  document.getElementById('placements-left').textContent = snap.done ? '' : ('이번 밤 남은 배치: ' + snap.placementsLeft + '번 · ' + nightLabel);

  // 기록지 · 이야기
  renderRecordSheet(snap.parts, snap.flags, snap.pushed);
  renderStoryPanel(snap);

  // 오버레이(모둠 순서 · 조각 고르기)
  const overlay = document.getElementById('overlay-panel');
  if (snap.isAiTurn) {
    overlay.hidden = true; // AI의 선택은 화면에 묻지 않는다
  } else if (snap.phase === 'combo_order') {
    overlay.hidden = false;
    overlay.innerHTML = '<p>' + snap.message + '</p><div class="opt-row">' + snap.comboOrderOptions.map(function (o) {
      return '<button data-combo-order="' + o.idx + '">' + COMBO_NAME[o.type] + '</button>';
    }).join('') + '</div>';
  } else if (snap.phase === 'combo_reward') {
    // 아래에서 올라오는 창이 기록지를 가리므로, 창 안에 지금 가진 조각을 함께 보여 준다.
    // 가장 적게 가진 조각(다음 태극기에 필요한 칸)은 빨간 테두리로 표시. 모두 같은 수면 표시하지 않는다
    const counts = PIECE_ORDER.map(function (k) { return snap.parts[k]; });
    const minCount = Math.min.apply(null, counts) < Math.max.apply(null, counts) ? Math.min.apply(null, counts) : -1;
    overlay.hidden = false;
    overlay.innerHTML = '<p>' + snap.message + '</p>' +
      '<div class="ov-label">지금 가진 조각</div><div class="record-sheet">' + recordSheetHtml(snap.parts, snap.flags, snap.pushed) + '</div>' +
      '<div class="opt-row">' + snap.rewardOptions.map(function (key) {
        const n = snap.parts[key];
        return '<button class="piece-btn' + (n === minCount ? ' need' : '') + '" data-reward="' + key + '"><span class="ic">' + pieceIcon(key, 28, true) + '</span>' +
          PIECE_NAME[key] + '<span class="cnt">' + n + '개</span></button>';
      }).join('') + '</div>';
  } else {
    overlay.hidden = true;
  }

  if (snap.done) {
    if (state.dawnFor !== g) { state.dawnFor = g; setTimeout(goToDawn, 450); }
  } else {
    announceTurn(snap);
    scheduleAi();
  }
}

// 자유 연습: 이번 밤 고르는 순서대로 플레이어 카드(말 색 · 이름 · 점수 · 작은 판).
// 이미 둔 사람은 흐리게, 지금 차례는 강조
function renderPlayersBar(snap) {
  const el = document.getElementById('players-bar');
  if (!snap.players) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<div class="order-label">이번 밤 순서 →</div>' + snap.order.map(function (pid, k) {
    const p = snap.players[pid];
    const cls = snap.done ? '' : (k < snap.orderAt ? ' done' : (k === snap.orderAt ? ' cur' : ''));
    return '<div class="p-card' + cls + '">' +
      '<div class="p-head">' + pawnDot(pid) + '<span class="nm">' + escapeHtml(p.name) + '</span>' +
        (p.type === 'ai' ? '<span class="ai">AI</span>' : '') + '<span class="sc">' + p.score + '</span></div>' +
      miniBoard(p.board) + '</div>';
  }).join('');
}

// 작은 판: 주사위 그림 + 오른쪽 아래 표시(2~6은 숫자, 밀정은 눈 모양)
const MINI_EYE = '<svg viewBox="0 0 20 12" aria-hidden="true"><path d="M1 6Q10-2.5 19 6Q10 14.5 1 6Z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="10" cy="6" r="3.2" fill="currentColor"/></svg>';
function miniBoard(board) {
  return '<div class="mini-board">' + board.map(function (d) {
    if (!d) return '<span></span>';
    return '<span><img src="img/dice/' + d.color + '_' + d.value + '.webp" alt="">' +
      (d.value === 1 ? '<b class="mn eye">' + MINI_EYE + '</b>' : '<b class="mn">' + d.value + '</b>') + '</span>';
  }).join('') + '</div>';
}

function pawnDot(pid) {
  return '<span class="dot" style="background:' + PAWN_COLORS[pid % PAWN_COLORS.length] + '">' + (pid + 1) + '</span>';
}

// ------------------------------------------------------------------
// 자유 연습 — 점수판 「3월 1일로 가는 길」(룰북 §2 · §4-2 · §8)
//   위 줄: 출발 · 1~10(밤하늘), 아래 줄: 11~20(오른쪽에서 왼쪽, 새벽), 16칸에 해가 뜬다.
//   20을 넘으면 화살표 칸(길이 계속 이어짐). 점수 상한은 없다.
//   같은 칸에 여럿이면 나중에 도착한 말이 위에 쌓이고, 위에 있는 말이 앞선다.
// ------------------------------------------------------------------
const TRACK_SKY_TOP = ['#12172a', '#161d30', '#1a2236', '#1e273f', '#222d48', '#283452', '#2f3c5c', '#3c4566', '#4a4f6c', '#5c596f', '#706470'];
const TRACK_SKY_BOTTOM = ['#faf3e3', '#f8ebcf', '#f6e0b6', '#f3d49f', '#efc77f', '#eab765', '#e2a35a', '#cc915c', '#b78462', '#a07769', '#8a6d6b'];
const TRACK_OVER = 21; // 20을 넘은 말이 서는 화살표 칸

function scoreTrackHtml() {
  const top = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const bottom = [TRACK_OVER, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11];
  const cell = function (n) {
    if (n === 0) return '<div class="tc start" data-pos="0">출발</div>';
    if (n === TRACK_OVER) return '<div class="tc more" data-pos="' + n + '" aria-label="20칸 너머">⟵</div>';
    let cls = 'tc';
    if (n % 5 === 0 && n <= 15) cls += ' mark';
    if (n === 16) cls += ' sun';
    if (n >= 17) cls += ' fade f' + n;
    return '<div class="' + cls + '" data-pos="' + n + '">' + n + '</div>';
  };
  const sky = function (colors, extra) {
    return '<div class="tsky">' + colors.map(function (c) { return '<span style="background:' + c + '"></span>'; }).join('') + (extra || '') + '</div>';
  };
  return '<div class="trk-title">3월 1일로 가는 길</div>' +
    '<div class="trk">' +
      sky(TRACK_SKY_TOP, '<i class="star" style="left:21%;top:62%"></i><i class="star" style="left:38%;top:40%"></i><i class="star" style="left:30%;top:80%"></i><i class="star" style="left:51%;top:70%"></i>') +
      '<div class="tbar">' + top.map(cell).join('') + '</div>' +
      sky(TRACK_SKY_BOTTOM, '<i class="sunrise"></i>') +
      '<div class="tbar">' + bottom.map(cell).join('') + '</div>' +
      '<div class="tturn"></div>' +
      '<div class="tpawns"></div>' +
    '</div>';
}

function renderScoreTrack(snap) {
  const el = document.getElementById('score-track');
  if (!snap.players) { el.hidden = true; return; }
  el.hidden = false;
  if (!el.dataset.built) { el.innerHTML = scoreTrackHtml(); el.dataset.built = '1'; }
  const t = state.track;
  if (t.game !== state.game) {
    // 새 판: 모두 출발 칸에서
    t.game = state.game;
    t.shown = {};
    clearTimeout(t.timer); t.timer = null;
    el.querySelector('.tpawns').innerHTML = pawnsHtml(snap.players);
    snap.players.forEach(function (p) { t.shown[p.id] = 0; });
  }
  t.players = snap.players;
  if (!t.timer) stepTrack();
}

// 점수가 오른 말을 한 칸씩 걸어가게 한다
function stepTrack() {
  const t = state.track;
  t.timer = null;
  if (!t.players) return;
  let moving = false;
  t.players.forEach(function (p) {
    if (t.shown[p.id] < p.score) { t.shown[p.id]++; moving = true; }
  });
  positionGameTrack();
  if (moving) t.timer = setTimeout(stepTrack, 230);
}

function pawnsHtml(players) {
  return players.map(function (p) {
    return '<div class="pawn" data-pid="' + p.id + '" style="background:' + PAWN_COLORS[p.id % PAWN_COLORS.length] + '" title="' + escapeHtml(p.name) + '">' + (p.id + 1) + '</div>';
  }).join('');
}

function positionGameTrack() {
  const trk = document.querySelector('#score-track .trk');
  if (trk && state.track.players) positionPawns(trk, state.track.players, state.track.shown);
}

// 말 놓기: shown[pid] = 지금 서 있는 칸. 점수보다 뒤에 있으면 걷는 중
function positionPawns(trk, players, shown) {
  // 칸별로 모아 쌓는 순서를 정한다: 먼저 도착한 말이 아래, 지금 걷는 중인 말은 맨 위
  const groups = {};
  players.forEach(function (p) {
    const pos = Math.min(shown[p.id], TRACK_OVER);
    const walking = shown[p.id] < p.score;
    (groups[pos] = groups[pos] || []).push({ p: p, key: walking ? Infinity : p.arrival });
  });
  Object.keys(groups).forEach(function (pos) {
    const cellEl = trk.querySelector('.tc[data-pos="' + pos + '"]');
    if (!cellEl) return;
    const cx = cellEl.offsetLeft + cellEl.offsetWidth / 2;
    const cy = cellEl.offsetTop + cellEl.offsetHeight / 2;
    groups[pos].sort(function (a, b) { return a.key - b.key; }).forEach(function (item, k) {
      const pawn = trk.querySelector('.pawn[data-pid="' + item.p.id + '"]');
      pawn.style.left = (cx + k * 2) + 'px';
      pawn.style.top = (cy - k * 6) + 'px';
      pawn.style.zIndex = String(k + 1);
      pawn.title = item.p.name + ' · ' + item.p.score + '점';
    });
  });
}


// 사람끼리 기기를 넘길 때 누구 차례인지 알려 준다
function announceTurn(snap) {
  if (!snap.players) return;
  const g = state.game;
  if (state.lastTurnId === g.playerId) return;
  const prev = state.lastTurnId;
  state.lastTurnId = g.playerId;
  const humans = snap.players.filter(function (p) { return p.type === 'human'; }).length;
  if (!snap.isAiTurn && humans > 1 && prev !== null) toast(snap.playerName + ' 차례예요');
}

// AI 차례면 잠깐 기다렸다가 한 걸음 진행 → 다시 그리기(→ 다음 걸음 예약)
function scheduleAi() {
  clearTimeout(state.aiTimer);
  const g = state.game;
  if (!g || !g.isAiTurn || g.done) return;
  const newTurn = g.phase === 'place' && g.placementsLeft === 2;
  const delay = g.phase === 'place' ? (newTurn ? 1100 : 800) : 550;
  state.aiTimer = setTimeout(function () {
    if (state.game !== g || !document.getElementById('screen-game').classList.contains('active')) return;
    const before = soundState();
    g.aiStep();
    if (g.lastAiCell != null) state.pulseCell = g.lastAiCell;
    playActionSounds(before);
    renderGame();
  }, delay);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

// 스무하루의 밤: 기록지 아래 이야기 패널. 가장 최근 카드를 펼쳐 두고, 그 전 이야기는 '지난 이야기'에 접어 둔다.
// 밤이 바뀔 때만 다시 그린다(펼쳐 둔 '지난 이야기'가 매 행동마다 닫히지 않도록).
function renderStoryPanel(snap) {
  const el = document.getElementById('story-panel');
  if (state.mode !== 'endless' || snap.done) { el.hidden = true; return; }
  el.hidden = false;
  if (el.dataset.night === String(snap.night)) return;
  el.dataset.night = String(snap.night);

  const cur = latestStory(snap.night);
  const past = [PROLOGUE];
  for (let n = 1; n < cur.night; n++) if (NIGHT_STORIES[n]) past.push(NIGHT_STORIES[n]);
  if (cur.night === 0) past.length = 0; // 프롤로그 자체가 지금 카드

  const isNew = cur.night === snap.night;
  el.innerHTML = '<div class="story-card' + (isNew ? ' fresh' : '') + '">' +
    '<div class="story-head"><span class="period">' + cur.story.period + '</span>' + (isNew ? '<span class="new">오늘 밤</span>' : '') + '</div>' +
    '<h3>' + cur.story.title + '</h3>' + cur.story.body + '</div>' +
    (past.length ? '<details class="story-past"><summary>지난 이야기 ' + past.length + '편</summary>' +
      past.map(function (s) { return '<div class="past-item"><div class="period">' + s.period + '</div><h4>' + s.title + '</h4>' + s.body + '</div>'; }).join('') +
      '</details>' : '');
}

// 게임 익히기 미션 카드: 별1 목표의 진행 · 별 기준 · 단계 안내
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

// 안내 팝업(미션 설명 · 이야기 카드 공용): 제목 · 강조 한 줄 · 본문 HTML
function openInfoModal(title, tag, bodyHtml) {
  document.getElementById('info-modal-title').textContent = title;
  document.getElementById('info-modal-tag').textContent = tag;
  document.getElementById('info-modal-body').innerHTML = bodyHtml;
  document.getElementById('info-modal').hidden = false;
  document.getElementById('info-modal-close').focus();
}

function closeInfoModal() {
  document.getElementById('info-modal').hidden = true;
}

// 미션 설명 팝업: 단계 이름 · 목표 · 별 기준 · 안내(intro · tips)
function openMissionModal() {
  const level = state.level;
  if (!level) return;
  const idx = state.campaignLevels.findIndex(function (l) { return l.id === level.id; });
  openInfoModal((idx >= 0 ? (idx + 1) + '단계 · ' : '') + level.title, goalDescription(level),
    (level.intro ? '<p>' + level.intro + '</p>' : '') +
    (level.tips && level.tips.length ? '<ul>' + level.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' : ''));
}

function renderRecordSheet(parts, flagsDone, pushed) {
  document.getElementById('record-sheet').innerHTML = recordSheetHtml(parts, flagsDone, pushed);
}

// 기록지: 태극 · 건 · 리 · 감 · 곤 다섯 칸 줄을 쌓은 모양(게임 화면 · 조각 고르는 창에서 함께 씀)
function recordSheetHtml(parts, flagsDone, pushed) {
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
  if (pushed > 0) html += '<div class="overflow-row">밀정을 쫓아냄 ' + pushed + '번 · +' + pushed + '점</div>';
  return html;
}

// ------------------------------------------------------------------
// 게임 화면 — 효과음
// ------------------------------------------------------------------
// 행동 전후의 기록을 비교해 무슨 일이 일어났는지에 맞는 북 장단을 고른다.
// 차례가 넘어가도 같은 사람을 비교하도록, 행동한 플레이어(pid)를 기억한다.
function soundState(pid) {
  const g = state.game;
  const p = g.g.players[pid == null ? g.playerId : pid];
  return {
    pid: p.id,
    stats: Object.assign({}, p.stats),
    pieces: Engine.pieceTotal(p), flags: Engine.flagsOf(p), night: g.night, done: g.done
  };
}

function playActionSounds(before) {
  const after = soundState(before.pid);
  const b = before.stats, a = after.stats;
  const changed = ['placements', 'same', 'consec', 'color', 'scatterLines', 'withdrawn', 'blocked', 'eyesRemoved']
    .some(function (k) { return a[k] !== b[k]; }) || after.pieces !== before.pieces || after.night !== before.night;
  if (!changed) { Sound.play('select'); return; } // 남길 사람 고르기 등
  // 놓은 소리 뒤에 결과 소리를 하나씩 이어 친다(동시에 시작하면 북이 뭉개진다).
  let d = 0;
  const next = function (name, gap) { Sound.play(name, d); d += Sound.span(name) + gap; };
  if (a.placements > b.placements) next('place', 0.18);
  if (a.same + a.consec + a.color > b.same + b.consec + b.color) next('combo', 0.3);
  if (a.eyesRemoved > b.eyesRemoved) next('eye', 0.25);
  if (after.flags > before.flags) next('flag', 0.3);
  else if (after.pieces > before.pieces) next('reward', 0.25);
  if (a.scatterLines > b.scatterLines) next('scatter', 0.25);
  if (a.withdrawn > b.withdrawn) next('withdraw', 0.25);
  if (a.blocked > b.blocked) next('blocked', 0.25);
  if (!after.done && after.night > before.night) Sound.play('night', d + 0.3);
}

// ------------------------------------------------------------------
// 게임 화면 — 입력
// ------------------------------------------------------------------
function onBoardClick(cell) {
  const g = state.game;
  if (g.isAiTurn) return;
  const snap = g.snapshot();
  const before = soundState();
  if (snap.phase === 'place') {
    if (snap.selectedPi == null) return;
    if (snap.validCells.indexOf(cell) < 0) return;
    if (g.placeAt(cell)) state.pulseCell = cell;
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
  if (g.isAiTurn) return;
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
  if (g.isAiTurn) return;
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
  state.endlessResult = state.mode === 'endless' ? saveEndlessResult(g.score, g.completed ? g.maxNights : g.night) : null;

  showScreen('dawn');
  if (g.endReason === 'sealed') { Sound.play('scatter'); Sound.play('dawn', 1.0); }
  else Sound.play('dawn');
  document.getElementById('dawn-result').hidden = true;
  document.getElementById('dawn-skip').hidden = false;
  const sky = document.getElementById('dawn-sky');
  sky.style.background = '#141a2b';
  document.getElementById('dawn-caption').textContent = g.endMessage();
  setTimeout(function () { sky.style.background = 'linear-gradient(180deg, #b98763, #ebb866, #f8ecd2)'; }, 120);

  // 완성한 태극기 장 수만큼 빛바랜 태극기를 걸고, 누르면 색이 들어온다.
  // 자유 연습은 룰북 §9 행렬 세우기: 맨 앞 지방이 태극기 한 장을 든다.
  const flagCount = state.mode === 'practice' ? 0 : g.flags;
  state.dawnPending = [];
  const paintArea = document.getElementById('dawn-paint-area');
  if (state.mode === 'practice') {
    const leader = g.standings()[0];
    paintArea.innerHTML = '<div class="dawn-flag">' + taegeukgiFlag(150) +
      '<div class="cap">가장 앞선 자리 ' + pawnDot(leader.id) + ' <b>' + escapeHtml(leader.name) + '</b></div></div>';
    showDawnResult();
  } else if (flagCount > 0) {
    let html = '';
    for (let i = 0; i < flagCount; i++) {
      html += '<button class="paint-btn" data-paint="' + i + '" aria-label="태극기 ' + (i + 1) + '장 색칠하기">' + taegeukgiFlag(120) + '</button>';
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

  const rankingEl = document.getElementById('dawn-ranking');
  if (state.mode === 'practice') {
    const st = g.standings();
    document.getElementById('dawn-score-line').textContent = '그날 아침의 행렬';
    rankingEl.innerHTML = st.map(function (p, i) {
      return '<li class="' + (i === 0 ? 'win' : '') + '"><span class="rk">' + (i + 1) + '</span>' +
        '<span class="nm">' + pawnDot(p.id) + ' ' + escapeHtml(p.name) + (p.type === 'ai' ? ' <span class="ai">AI</span>' : '') + '</span>' +
        '<span class="sub">태극기 ' + p.flags + ' · 조각 ' + p.pieces + (p.pushed ? ' · 밀정 쫓아냄 ' + p.pushed : '') + '</span>' +
        '<span class="pts">' + p.score + '점</span>' + miniBoard(p.board) + '</li>';
    }).join('');
    rankingEl.hidden = false;
  } else {
    document.getElementById('dawn-score-line').textContent = g.score + '점 · 태극기 ' + g.flags + '장';
    rankingEl.hidden = true;
  }

  const starsLineEl = document.getElementById('dawn-stars-line');
  const goalLineEl = document.getElementById('dawn-goal-line');
  starsLineEl.classList.remove('record');
  if (state.mode === 'campaign') {
    starsLineEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    starsLineEl.hidden = false;
    goalLineEl.textContent = goalDescription(level);
    goalLineEl.hidden = false;
  } else if (state.mode === 'practice') {
    // 같은 점수가 있으면 동점 규칙을 알려 준다(룰북 §9)
    const st = g.standings();
    const tie = st.some(function (p, i) { return i > 0 && p.score === st[i - 1].score; });
    starsLineEl.hidden = true;
    goalLineEl.textContent = tie ? '같은 점수면 그 칸에 나중에 올라선(위에 있는) 말이 앞서요.' : '';
    goalLineEl.hidden = !tie;
  } else if (state.mode === 'endless') {
    const r = state.endlessResult;
    const showNew = r.isNew && g.score > 0; // 0점 첫 기록은 축하하지 않음
    starsLineEl.textContent = showNew ? '새 최고 기록!' : '';
    starsLineEl.classList.add('record');
    starsLineEl.hidden = !showNew;
    goalLineEl.textContent = (g.completed ? '스물한 밤을 모두 버텼어요' : nightDate(g.night) + ' 밤까지(' + g.night + '/' + g.maxNights + ')') +
      ' · 최고 기록 ' + r.best.score + '점(' + r.best.nights + '밤)';
    goalLineEl.hidden = false;
  } else {
    starsLineEl.hidden = true;
    goalLineEl.hidden = true;
  }

  // 스무하루의 밤을 끝까지 버티면 3월 1일 이야기
  const storyEl = document.getElementById('dawn-story');
  if (state.mode === 'endless' && g.completed) {
    storyEl.innerHTML = '<div class="period">' + MARCH_FIRST.period + '</div><h3>' + MARCH_FIRST.title + '</h3>' + MARCH_FIRST.body;
    storyEl.hidden = false;
  } else {
    storyEl.hidden = true;
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
  renderDawnTrack();
}

// 자유 연습 결과: 끝났을 때의 점수판(말은 최종 칸에, 같은 칸은 나중에 온 말이 위)
function renderDawnTrack() {
  const el = document.getElementById('dawn-track');
  if (state.mode !== 'practice') { el.hidden = true; return; }
  el.hidden = false;
  if (!el.dataset.built) { el.innerHTML = scoreTrackHtml(); el.dataset.built = '1'; }
  const players = state.game.snapshot().players;
  el.querySelector('.tpawns').innerHTML = pawnsHtml(players);
  positionDawnTrack();
}

function positionDawnTrack() {
  const el = document.getElementById('dawn-track');
  if (el.hidden || state.mode !== 'practice' || !state.game) return;
  const players = state.game.snapshot().players;
  const shown = {};
  players.forEach(function (p) { shown[p.id] = p.score; });
  positionPawns(el.querySelector('.trk'), players, shown);
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
      if (target === 'practice-setup') renderPracticeSetup();
      if (target === 'endless-start') { startGame(makeEndlessLevel(), 'endless'); return; }
      showScreen(target);
      return;
    }
    const levelBtn = e.target.closest('[data-level]');
    if (levelBtn && !levelBtn.disabled) {
      const lv = state.levelsById[levelBtn.dataset.level];
      if (lv) startGame(lv, 'campaign');
      return;
    }
    const countBtn = e.target.closest('#setup-count button');
    if (countBtn) {
      state.practiceSetup.count = Number(countBtn.dataset.count);
      savePracticeSetup(state.practiceSetup);
      Sound.play('tap'); renderPracticeSetup(); return;
    }
    const seatBtn = e.target.closest('[data-seat-type]');
    if (seatBtn) {
      state.practiceSetup.seats[Number(seatBtn.dataset.seat)].type = seatBtn.dataset.seatType;
      savePracticeSetup(state.practiceSetup);
      Sound.play('tap'); renderPracticeSetup(); return;
    }
    if (e.target.closest('#btn-practice-start')) { startPractice(); return; }
    if (e.target.closest('#mission.has-help')) { Sound.play('tap'); openMissionModal(); return; }
    if (e.target.closest('#btn-night-story')) {
      document.getElementById('story-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('#info-modal-close') || e.target.id === 'info-modal') { closeInfoModal(); return; }
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

  document.getElementById('btn-game-quit').addEventListener('click', function () {
    const g = state.game;
    if (!g || g.done) return;
    if (confirm('여기서 마칠까요? 지금까지의 ' + g.score + '점으로 기록돼요.')) {
      g.quit();
      renderGame();
    }
  });

  document.getElementById('dawn-skip').addEventListener('click', function () {
    document.querySelectorAll('#dawn-paint-area .paint-btn:not(.painted)').forEach(function (btn) {
      btn.classList.add('painted');
    });
    state.dawnPending = [];
    showDawnResult();
  });

  document.getElementById('btn-dawn-again').addEventListener('click', function () {
    if (state.mode === 'practice') startGame(makePracticeLevel(), 'practice', state.practiceSeats);
    else if (state.mode === 'endless') startGame(makeEndlessLevel(), 'endless');
    else startGame(state.level, 'campaign');
  });

  document.getElementById('btn-dawn-home').addEventListener('click', function () {
    showScreen('title');
  });

  // 이름은 입력하는 대로 자리 구성에 저장(다음에 열어도 남아 있도록)
  document.getElementById('setup-seats').addEventListener('input', function (e) {
    const i = e.target.dataset.seatName;
    if (i == null) return;
    state.practiceSetup.seats[Number(i)].name = e.target.value;
    savePracticeSetup(state.practiceSetup);
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

  window.addEventListener('resize', function () { positionGameTrack(); positionDawnTrack(); });

  // 자동재생 정책: 첫 터치/클릭 때 소리를 켠다. 앱이 가려지면 배경음을 멈춘다.
  document.addEventListener('pointerdown', function () { Sound.unlock(); }, { capture: true });
  document.addEventListener('keydown', function (e) {
    Sound.unlock();
    if (e.key === 'Escape' && !document.getElementById('info-modal').hidden) closeInfoModal();
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
  wireStaticEvents();
  showScreen('title');
  try { await loadLevels(); } catch (e) { /* 목록이 없어도 자유 연습은 동작 */ }
  registerServiceWorker();
}

init();
