/*
 * js/ui.js — 화면 그리기 · 이벤트 연결
 * ------------------------------------------------------------------
 * solo.js · multi.js(진행) · art.js(그림) · engine.js(판정, solo.js를 통해서만 접근)를
 * 가져다 DOM에 그리고, 탭 입력을 solo.js의 행동 함수로 그대로 넘긴다.
 */
import {
  SoloGame,
  makePracticeLevel, makeEndlessLevel, saveEndlessResult,
  requestPersistentStorage, getSettings, setSettings,
  getTutorialProgress, saveTutorialSceneDone, skipTutorial,
  getPracticeSetup, savePracticeSetup, getSavedNames, addSavedNames,
  saveCrackdownResult
} from './solo.js';
import { MultiGame } from './multi.js';
import { TUTORIAL_SCENES, TutorialGame, sceneTitle, sceneSub, sceneCardCount } from './tutorial.js';
// 글 파일(texts/*.md). 이 파일에는 첫 걸음 상태를 뜻하는 지역 변수 t가 많아 tx로 부른다
import { loadTexts, t as tx, tText, fillTextSlots } from './texts.js';
import { FirstRoll, rollDie } from './firstRoll.js';
import { quickRulesHtml, ensureQuickRulesStyle } from './quickRules.js';
import { CrackdownGame, makeCrackdownLevel, nightOrdinal, CRACKDOWN_CONFIG } from './crackdown.js';
import { Engine } from './engine.js';
import {
  taegeukgiFlag, trigramIcon, dieIcon, lanternIcon, pieceIcon
} from './art.js';
import { Sound } from './audio.js';
import { PIECE_NAME, PIECE_ORDER, COMBO_NAME, escapeHtml, applySoundSettings as applySound, registerServiceWorker } from './common.js';
import { PROLOGUE, NIGHT_STORIES, MARCH_FIRST, nightDate, latestStory, buildStories } from './story.js';

// 화면에 보이는 모둠 이름(규칙 보기와 같은 이름). 엔진의 TYPE_NAME은 판정용 설명이다.
// 자유 연습: 자리(지방)마다 점수판 말 색
const PAWN_COLORS = ['#c8312f', '#1f4e9a', '#3f7d4e', '#d9962b', '#7b4d8f'];

// ------------------------------------------------------------------
// 전역 상태
// ------------------------------------------------------------------
const state = {
  game: null,
  level: null,
  mode: null, // 'practice' | 'tutorial' | 'endless' | 'crackdown'
  tut: null,                           // 첫 걸음: { index(장면), sub(이야기 카드), stage · seen · person(주사위 장면), view }
  tutFinishFor: null,                  // 정리 카드를 이미 예약한 장면(두 번 가지 않도록)
  tutHintShown: null,                  // 말풍선 힌트가 새로 바뀌었을 때만 튀어나오게
  crackdownCards: null,                // data/crackdown.json({ stories, patterns })
  dayTimer: null,                      // 단속의 밤: 낮 단속을 한 칸씩 진행하는 타이머
  dayCell: null,                       // 방금 낮 단속이 지나간 칸과 결과({ cell, kind })
  crackdownResult: null,
  storyPopupKey: null,                 // 이미 팝업으로 보여 준 밤(같은 이야기를 두 번 띄우지 않도록)
  returnScreen: 'title',
  settings: getSettings(),
  dawnPending: [],
  practiceSetup: getPracticeSetup(), // 자유 연습 자리 구성(인원 · 사람/AI · 이름)
  practiceSeats: null,               // 이번 판에 실제로 앉은 자리(다시 하기용)
  roll: null,                        // 자유 연습 순서 정하기: { fr(FirstRoll), seats, spinning: { 자리: true } }
  rollTimers: [],                    // 굴리는 연출 · AI가 굴리는 타이머
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
  document.getElementById('mode-sheet').hidden = true;
  clearTimeout(state.aiTimer);
  clearTimeout(state.dayTimer); state.dayTimer = null;
  clearRollTimers();
  document.body.classList.remove('is-day');
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

// 처음 화면 ⓘ: 놀이 방법 설명 카드. 글은 texts/title.md(title.<key>.more), [시작하기]는 메뉴 버튼과 같은 곳으로
const MODE_INFO = {
  tutorial: { title: '첫 걸음', nav: 'tutorial' },
  endless: { title: '스무하루의 밤', nav: 'endless-start' },
  crackdown: { title: '단속의 밤', nav: 'crackdown-start' },
  practice: { title: '자유 연습', nav: 'practice-setup' },
  link: { title: '기기끼리 함께하기', href: 'link.html' }
};

function openModeSheet(key) {
  const m = MODE_INFO[key];
  if (!m) return;
  document.getElementById('mode-sheet-title').textContent = m.title;
  document.getElementById('mode-sheet-body').innerHTML = tx('title.' + key + '.more');
  document.getElementById('mode-sheet-actions').innerHTML =
    (m.href ? '<a class="primary" href="' + m.href + '">시작하기</a>' : '<button class="primary" data-nav="' + m.nav + '">시작하기</button>') +
    '<button class="ghost" id="mode-sheet-close">닫기</button>';
  const sheet = document.getElementById('mode-sheet');
  sheet.hidden = false;
  document.getElementById('mode-sheet-close').focus({ preventScroll: true });
}

function closeModeSheet() { document.getElementById('mode-sheet').hidden = true; }

// ------------------------------------------------------------------
// 첫 걸음 — 하나로 이어지는 과정(js/tutorial.js). 기획: docs/첫걸음_개편_시나리오.md
// ------------------------------------------------------------------
function tutSceneLabel(scene) {
  return scene.num != null ? '장면 ' + scene.num + ' · ' + sceneTitle(scene) : sceneTitle(scene);
}

// 진행 점: 지난 장면 · 지금 장면 · 남은 장면
function tutDotsHtml(index) {
  return TUTORIAL_SCENES.map(function (s, i) {
    return '<span' + (i < index ? ' class="past"' : i === index ? ' class="on"' : '') + '></span>';
  }).join('');
}

// 처음 화면: 마침 여부 · 이어 하기 · 처음부터 · 건너뛰기 · 장면 골라 보기
function renderTutorialHome() {
  const prog = getTutorialProgress();
  const total = TUTORIAL_SCENES.length;
  const last = total - 1;
  let status;
  if (prog.done) status = '<span class="done-tag">마침</span>' + tx('home.done');
  else if (prog.reached < 0) status = tx('home.new');
  else status = tx('home.progress', { done: prog.reached + 1, total: total });

  let actions = '';
  if (prog.done) {
    actions += '<button class="primary" data-tut-start="0">처음부터 다시 보기</button>';
  } else if (prog.reached < 0) {
    actions += '<button class="primary" data-tut-start="0">시작하기</button>';
  } else {
    const nextIdx = Math.min(prog.reached + 1, last);
    actions += '<button class="primary" data-tut-start="' + nextIdx + '">이어 하기 — ' + tutSceneLabel(TUTORIAL_SCENES[nextIdx]) + '</button>' +
      '<button data-tut-start="0">처음부터</button>';
  }
  if (!prog.done) actions += '<button class="ghost" data-tut="skip">과정 건너뛰기</button>';

  const rows = TUTORIAL_SCENES.map(function (scene, i) {
    const unlocked = prog.done || i <= prog.reached + 1;
    return '<button class="level-row' + (unlocked ? '' : ' locked') + '" data-tut-start="' + i + '" ' + (unlocked ? '' : 'disabled') + '>' +
      '<div class="num">' + (scene.num != null ? scene.num : '끝') + '</div>' +
      '<div class="info"><div class="t">' + escapeHtml(sceneTitle(scene)) + '</div><div class="m">' + escapeHtml(sceneSub(scene)) + '</div></div>' +
      '<div class="mark">' + (i <= prog.reached ? '마침' : (unlocked ? '' : '🔒')) + '</div>' +
      '</button>';
  }).join('');

  document.getElementById('tut-home').innerHTML =
    '<div class="tut-status">' + status + '</div>' + actions +
    '<p class="muted" style="margin:8px 0 0;">' + (prog.done ? '장면 골라 보기' : '장면 골라 보기 · 마친 장면과 다음 장면을 열 수 있어요') + '</p>' +
    '<div class="tut-list">' + rows + '</div>';
}

function startTutorialScene(index) {
  const scene = TUTORIAL_SCENES[index];
  if (!scene) { showScreen('tutorial'); renderTutorialHome(); return; }
  state.tut = { index: index, sub: 0, stage: 'colors', seen: {}, person: null, view: 'scene' };
  if (scene.kind === 'play') { startGame(scene, 'tutorial'); return; }
  showScreen('tutorial-card');
  renderTutorialCard();
}

// 이야기 · 주사위 · 정리 카드
function renderTutorialCard() {
  const t = state.tut;
  const scene = TUTORIAL_SCENES[t.index];
  const isLast = t.index === TUTORIAL_SCENES.length - 1;
  document.getElementById('tut-card-dots').innerHTML = tutDotsHtml(t.index);
  const card = document.getElementById('tut-card');
  const actionsEl = document.getElementById('tut-card-actions');
  let html = '', actions = '';

  if (t.view === 'summary') {
    const sum = scene.summary || {};
    html = '<div class="tut-eyebrow">정리</div><h2>' + escapeHtml(sceneTitle(scene)) + '</h2>';
    if (scene.goal && state.game instanceof TutorialGame) {
      const g = state.game;
      html += '<div class="tut-result">' + tx(g.goalMet ? 'free.good.title' : 'free.bad.title') + '</div>' +
        '<p class="tut-text center">' + g.score + '점 · 모둠 ' + g.sceneCombos + '개 · 태극기 ' + g.flags + '장</p>' +
        '<p class="tut-text">' + tx(g.goalMet ? 'free.good' : 'free.bad') + '</p>';
    }
    if (sum.dice) html += '<div class="tut-dice">' + sum.dice.map(function (d) { return dieIcon(d[0], d[1], 52); }).join('') + '</div>';
    if (scene.summary) html += '<div class="tut-text">' + tx(scene.id + '.summary') + '</div>';
    if (sum.extra) {
      html += '<div class="tut-extra"><h3>' + tx(scene.id + '.extra.title') + '</h3><div class="tut-boards">' + sum.extra.boards.map(function (b, bi) {
        const board = [];
        for (let i = 0; i < 9; i++) board.push(b[i] ? { color: b[i][0], value: b[i][1] } : null);
        return '<div class="tut-board-row">' + miniBoard(board) + '<span>' + tx(scene.id + '.extra.' + (bi + 1)) + '</span></div>';
      }).join('') + '</div></div>';
    }
    const nextLabel = scene.goal && state.game instanceof TutorialGame && !state.game.goalMet ? '이대로 마치기' : '다음 장면';
    actions = '<button class="primary" data-tut="summary-next">' + nextLabel + '</button>' +
      '<button class="ghost" data-tut="retry">다시 해 보기</button>';
  } else if (scene.kind === 'story') {
    const lastCard = t.sub >= sceneCardCount(scene) - 1;
    html = '<div class="tut-eyebrow">' + (scene.num != null ? '장면 ' + scene.num : '끝') + '</div><h2>' + escapeHtml(sceneTitle(scene)) + '</h2>' +
      '<div class="tut-story">' + tx(scene.id + '.card.' + (t.sub + 1)) + '</div>';
    if (!lastCard) actions = '<button class="primary" data-tut="story-next">다음</button>';
    else if (isLast) actions = '<button class="primary" data-tut="end-title">타이틀로</button><button class="ghost" data-tut="end-home">첫 걸음 다시 보기</button>';
    else actions = '<button class="primary" data-tut="story-next">' + scene.button + '</button>';
  } else if (scene.kind === 'dice') {
    const colorsSeen = scene.dice.filter(function (d, i) { return !d.spy && t.seen[i]; }).length;
    const colorsTotal = scene.dice.filter(function (d) { return !d.spy; }).length;
    // 단계별 안내 글: texts/tutorial.md의 people.colors · people.order · people.spy · people.spyInfo
    html = '<div class="tut-eyebrow">장면 ' + scene.num + '</div><h2>' + escapeHtml(sceneTitle(scene)) + '</h2>' +
      '<div class="tut-text">' + tx('people.' + t.stage, { seen: colorsSeen, total: colorsTotal }) + '</div>' +
      '<div class="tut-dice">' + scene.dice.map(function (d, i) {
        return '<button data-tut-die="' + i + '" class="' + (t.person === i ? 'cur' : (t.seen[i] ? 'seen' : '')) + '" aria-label="' + (d.spy ? '밀정' : d.name) + '">' + dieIcon(d.color, d.value, 58) + '</button>';
      }).join('') + '</div>';
    let person = tx('people.idle');
    if (t.person != null) {
      const d = scene.dice[t.person];
      if (d.spy && t.stage === 'colors') person = tx('people.spyEarly');
      else if (d.spy) person = '<span class="nm">밀정</span><br>' + tx('people.spyDesc');
      else person = '<span class="nm">' + d.name + '</span> · 눈 ' + d.value + '<br>' + d.group;
    }
    html += '<div class="tut-person">' + person + '</div>';
    if (t.stage === 'order' || t.stage === 'spyInfo') actions = '<button class="primary" data-tut="dice-next">다음</button>';
  }
  card.innerHTML = html;
  actionsEl.innerHTML = actions;
}

function onTutorialDieClick(i) {
  const t = state.tut;
  const scene = TUTORIAL_SCENES[t.index];
  const d = scene.dice[i];
  t.person = i;
  Sound.play('select');
  if (d.spy) {
    if (t.stage === 'spy') t.stage = 'spyInfo';
  } else {
    t.seen[i] = true;
    const allSeen = scene.dice.every(function (x, k) { return x.spy || t.seen[k]; });
    if (t.stage === 'colors' && allSeen) t.stage = 'order';
  }
  renderTutorialCard();
}

// 장면을 마치면 정리 카드(이야기 장면은 바로 다음 장면)
function finishTutorialScene() {
  const t = state.tut;
  saveTutorialSceneDone(t.index, false);
  t.view = 'summary';
  showScreen('tutorial-card');
  renderTutorialCard();
}

function onTutorialAction(action) {
  const t = state.tut;
  Sound.play('tap');
  if (action === 'skip') {
    if (confirm('첫 걸음을 건너뛸까요? 건너뛰어도 "마침"으로 표시되고, 언제든 다시 볼 수 있어요.')) { skipTutorial(); renderTutorialHome(); }
    return;
  }
  if (action === 'coach-next') {
    const g = state.game;
    const before = soundState();
    if (g.next()) { playActionSounds(before); renderGame(); }
    return;
  }
  if (action === 'coach-retry') { startTutorialScene(t.index); return; }
  if (action === 'retry') { startTutorialScene(t.index); return; }
  if (action === 'story-next') {
    const scene = TUTORIAL_SCENES[t.index];
    if (t.sub < sceneCardCount(scene) - 1) { t.sub++; renderTutorialCard(); return; }
    saveTutorialSceneDone(t.index, false);
    startTutorialScene(t.index + 1);
    return;
  }
  if (action === 'dice-next') {
    if (t.stage === 'order') { t.stage = 'spy'; t.person = null; renderTutorialCard(); return; }
    if (t.stage === 'spyInfo') { finishTutorialScene(); return; }
    return;
  }
  if (action === 'summary-next') { startTutorialScene(t.index + 1); return; }
  if (action === 'end-title' || action === 'end-home') {
    saveTutorialSceneDone(t.index, true);
    toast('첫 걸음을 마쳤어요');
    if (action === 'end-title') { showScreen('title'); return; }
    showScreen('tutorial'); renderTutorialHome();
  }
}

// 첫 걸음 놀이 장면: 코치 말풍선(장면 · 진행 점 · 할 말 · 힌트 · [다음] · [다시 하기])
function renderCoach(g) {
  const el = document.getElementById('coach');
  if (state.mode !== 'tutorial') { el.hidden = true; return; }
  const scene = g.scene;
  const c = g.coach();
  let text = c.text;
  if (!g.step && scene.goal) {
    text = g.done ? '세 밤이 지났어요.' : '목표: <b>모둠 ' + scene.goal.combos + '개</b> 또는 <b>' + scene.goal.score + '점</b> · 지금 모둠 ' + g.sceneCombos + '개 · ' + g.score + '점';
  } else if (g.finished) {
    text = '장면을 마쳤어요.';
  }
  const freshHint = c.hint && c.hint !== state.tutHintShown;
  state.tutHintShown = c.hint;
  el.innerHTML = '<div class="coach-head"><span class="coach-scene">' + tutSceneLabel(scene) + '</span><span class="tut-dots">' + tutDotsHtml(state.tut ? state.tut.index : 0) + '</span></div>' +
    '<div class="coach-text">' + text + '</div>' +
    (c.hint ? '<div class="coach-hint' + (freshHint ? ' fresh' : '') + '">' + c.hint + '</div>' : '') +
    '<div class="coach-actions"><button data-tut="coach-retry">다시 하기</button>' +
    (c.canNext ? '<button class="primary" data-tut="coach-next">다음</button>' : '') + '</div>';
  el.hidden = false;
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
// 글은 texts/rules.md(rules.*)에 있다. 위에서부터 한 칸씩, 주사위 속 사람들만 아래에 그림으로 붙인다
const RULES_SECTIONS = ['rules.intro', 'rules.dice', 'rules.night', 'rules.place', 'rules.combos', 'rules.after',
  'rules.scatter', 'rules.score', 'rules.endless', 'rules.modes', 'rules.crackdown', 'rules.people'];

function renderRules() {
  const el = document.getElementById('rules-content');
  const f = CRACKDOWN_CONFIG.FLAGS_PER_COMBO;
  const vars = {
    start_flags: CRACKDOWN_CONFIG.START_FLAGS, same: f.same, consec: f.consec, color: f.color,
    star1: CRACKDOWN_CONFIG.STARS[0], star2: CRACKDOWN_CONFIG.STARS[1], star3: CRACKDOWN_CONFIG.STARS[2]
  };
  const peopleHtml = DICE_PEOPLE.map(function (g) {
    return '<h4 class="people-group">' + g.group + '</h4><div class="people-row">' + g.names.map(function (n, i) {
      return '<figure>' + dieIcon(g.color, i + 2, 44) + '<figcaption>' + n + '</figcaption></figure>';
    }).join('') + '</div>';
  }).join('') +
    '<div class="combo-example"><div class="dice">' + dieIcon('black', 1, 44) + '</div><div>' + tx('rules.people.spy') + '</div></div>';
  el.innerHTML = RULES_SECTIONS.map(function (key) {
    return '<div class="rules-block">' + tx(key, vars) + (key === 'rules.people' ? peopleHtml : '') + '</div>';
  }).join('');
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
  openFirstRoll(seats);
}

// ------------------------------------------------------------------
// 자유 연습 — 첫 밤 순서 정하기(룰북 「게임 준비」 5): 각자 주사위를 굴려 눈이 큰 사람부터 1위
// 한 기기를 돌려 가며 사람은 [굴리기]를 누르고, AI는 잠깐 뒤 스스로 굴린다. 같은 눈끼리는 다시 굴린다.
// ------------------------------------------------------------------
const ROLL_SPIN_MS = 650;

function clearRollTimers() {
  state.rollTimers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
  state.rollTimers = [];
  if (state.roll) state.roll.spinning = {};
}

function openFirstRoll(seats) {
  state.roll = { fr: new FirstRoll(seats.length), seats: seats, spinning: {} };
  showScreen('first-roll');
  renderFirstRoll();
}

function renderFirstRoll() {
  const r = state.roll;
  if (!r) return;
  const fr = r.fr;
  const ranks = fr.ranks();
  const tied = fr.active.length && fr.history.some(function (h) { return h.length; }) ? fr.active : [];
  const hint = document.getElementById('roll-hint');
  if (fr.done) hint.textContent = '순서가 정해졌어요. 1위부터 첫 밤에 먼저 골라요.';
  else if (tied.length) hint.innerHTML = '<b>' + tied.map(function (i) { return escapeHtml(r.seats[i].name); }).join(' · ') + '</b> 같은 눈! 이 사람들만 다시 굴려요.';
  else hint.textContent = '각자 주사위를 굴려요. 눈이 큰 사람부터 첫 밤에 먼저 골라요. 밀정(1)은 가장 작은 눈이에요.';

  // 다 정해지면 순위대로, 아니면 자리 순서대로
  const rows = fr.done ? fr.order() : r.seats.map(function (s, i) { return i; });
  const nextHuman = rows.find(function (i) { return fr.needs(i) && r.seats[i].type === 'human' && !r.spinning[i]; });
  document.getElementById('roll-seats').innerHTML = rows.map(function (i) {
    const seat = r.seats[i];
    const face = fr.faces[i];
    const spin = !!r.spinning[i];
    const needs = fr.needs(i);
    let right;
    if (needs && seat.type === 'human') right = '<button class="' + (i === nextHuman ? 'primary' : '') + '" data-roll="' + i + '"' + (spin ? ' disabled' : '') + '>' + (fr.history[i].length ? '다시 굴리기' : '굴리기') + '</button>';
    else if (needs) right = '<span class="wait">굴리는 중…</span>';
    // 다시 굴린 사람은 처음 눈부터 보여 준다(예: 눈 3 → 6). 처음 눈이 같아 다시 굴린 것이므로
    else right = '<span class="wait">' + (face ? '눈 ' + fr.history[i].join(' → ') : '') + '</span>';
    const cls = 'roll-row' + (needs && i === nextHuman ? ' next' : '') + (tied.indexOf(i) >= 0 ? ' tie' : '');
    return '<div class="' + cls + '" data-roll-row="' + i + '">' +
      '<span class="rank">' + (ranks[i] && !needs ? ranks[i] + '위' : '') + '</span>' +
      '<span class="who">' + pawnDot(i) + '<span class="nm">' + escapeHtml(seat.name) + '</span>' + (seat.type === 'ai' ? '<span class="ai">AI</span>' : '') + '</span>' +
      '<span class="die-slot' + (face ? ' has' : '') + (spin ? ' spin' : '') + '">' + (face ? dieIcon(face.color, face.value, 46) : '') + '</span>' +
      right + '</div>';
  }).join('');
  document.getElementById('btn-roll-start').hidden = !fr.done;
  scheduleAiRolls();
}

// 굴리는 연출: 잠깐 여러 면이 바뀌다가 멈춘다. 결과는 미리 정해 두고 마지막에 적는다
function rollFor(seat) {
  const r = state.roll;
  if (!r || !r.fr.needs(seat) || r.spinning[seat]) return;
  r.spinning[seat] = true;
  const result = rollDie();
  renderFirstRoll();
  const slotOf = function () { return document.querySelector('[data-roll-row="' + seat + '"] .die-slot'); };
  const spinner = setInterval(function () {
    const el = slotOf();
    if (el) { const d = rollDie(); el.classList.add('has', 'spin'); el.innerHTML = dieIcon(d.color, d.value, 46); }
  }, 90);
  Sound.play('select');
  state.rollTimers.push(spinner);
  state.rollTimers.push(setTimeout(function () {
    clearInterval(spinner);
    if (state.roll !== r) return;
    delete r.spinning[seat];
    r.fr.roll(seat, result);
    Sound.play(r.fr.done ? 'combo' : 'place');
    renderFirstRoll();
  }, ROLL_SPIN_MS));
}

// AI 자리는 사람이 다 굴린 뒤가 아니라, 자기 차례가 오면 하나씩 조금씩 늦게 굴린다
function scheduleAiRolls() {
  const r = state.roll;
  if (!r || r.fr.done || r.aiPending) return;
  const ai = r.fr.active.find(function (i) { return r.fr.needs(i) && r.seats[i].type === 'ai' && !r.spinning[i]; });
  if (ai == null) return;
  r.aiPending = true;
  state.rollTimers.push(setTimeout(function () {
    r.aiPending = false;
    if (state.roll !== r) return;
    rollFor(ai);
  }, 450));
}

function startPracticeWithOrder() {
  const r = state.roll;
  if (!r || !r.fr.done) return;
  startGame(makePracticeLevel(), 'practice', r.seats, r.fr.order());
}

// ------------------------------------------------------------------
// 설정
// ------------------------------------------------------------------
function renderSettings() {
  document.getElementById('toggle-hints').checked = !!state.settings.hints;
  document.getElementById('toggle-bgm').checked = state.settings.bgm !== false;
  document.getElementById('toggle-sfx').checked = state.settings.sfx !== false;
}

function applySoundSettings() { applySound(state.settings); }

// ------------------------------------------------------------------
// 게임 화면 — 시작
// ------------------------------------------------------------------
function startGame(level, mode, seats, firstOrder) {
  clearTimeout(state.aiTimer);
  state.level = level;
  state.mode = mode;
  clearTimeout(state.dayTimer); state.dayTimer = null;
  if (mode === 'practice') state.game = new MultiGame(level, seats, firstOrder);
  else if (mode === 'crackdown') state.game = new CrackdownGame(level, state.crackdownCards);
  else if (mode === 'tutorial') state.game = new TutorialGame(level);
  else state.game = new SoloGame(level, mode, {});
  state.tutFinishFor = null;
  state.tutHintShown = null;
  state.lastTurnId = null;
  state.pulseCell = null;
  state.dayCell = null;
  state.storyPopupKey = null;
  clearTimeout(state.track.timer); state.track.timer = null; state.track.game = null;
  state.returnScreen = mode === 'tutorial' ? 'tutorial' : 'title';
  // 스무하루의 밤은 ← 대신 '종료'(점수 기록 후 끝내기)
  document.getElementById('btn-game-exit').hidden = mode === 'endless';
  document.getElementById('btn-game-quit').hidden = mode !== 'endless';
  // 여럿일 때는 아래 점수 줄로, 단속의 밤은 위쪽 상태 줄(숨겨 둔 태극기)로
  document.getElementById('score-badge').hidden = mode === 'practice' || mode === 'crackdown';
  showScreen('game');
  document.getElementById('story-panel').dataset.night = '';
  document.getElementById('cd-status').innerHTML = '';
  document.getElementById('cd-panel').dataset.key = '';
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
  document.getElementById('game-message').hidden = state.mode === 'tutorial'; // 첫 걸음은 코치 말풍선이 대신한다
  renderPlayersBar(snap);
  renderScoreTrack(snap);
  renderCrackdown(snap);

  renderCoach(g);
  // 첫 걸음: 지금 단계에서 강조할 주사위 · 칸 · 조각, 틀렸을 때 흔들 대상
  const tut = state.mode === 'tutorial' ? g.targets() : null;
  const shake = state.mode === 'tutorial' ? g.shake : null;
  if (shake) g.shake = null;

  // 단속의 밤: 이번 낮에 밀정이 올 칸(낮 단속 중이면 아직 지나가지 않은 칸만)
  let cdMarks = [];
  if (snap.crackdown && !snap.done && snap.crackdown.card) {
    const day = snap.crackdown.day;
    const passed = day ? day.results.map(function (r) { return r.cell; }) : [];
    cdMarks = snap.crackdown.card.cells.filter(function (c) { return passed.indexOf(c) < 0; });
  }

  // 판
  const boardEl = document.getElementById('board');
  const showScatterHint = currentHintsEnabled() && snap.phase === 'place' && snap.selectedPi != null;
  let boardHtml = '';
  for (let i = 0; i < 9; i++) {
    const die = snap.board[i];
    const classes = ['cell'];
    let mark = '';
    if (cdMarks.indexOf(i) >= 0) {
      classes.push(die ? 'cd-guard' : 'cd-mark');
      mark = die ? '<span class="cd-guard-tag">지켜 냄</span>' : '<span class="cd-eye">' + MINI_EYE + '</span>';
    }
    if (state.dayCell && state.dayCell.cell === i) classes.push(state.dayCell.kind === 'spy' ? 'cd-hit' : 'cd-saved');
    if (snap.phase === 'place' && snap.selectedPi != null && snap.validCells.indexOf(i) >= 0) {
      if (tut && tut.cells.length) {
        if (tut.cells.indexOf(i) >= 0) classes.push('valid', 'tut-target');
      } else {
        classes.push('valid');
        if (showScatterHint && g.wouldScatterAt(snap.selectedPi, i)) classes.push('scatter-warn');
      }
    }
    if (snap.phase === 'combo_keep' && snap.keepLine && snap.keepLine.indexOf(i) >= 0) classes.push('choosable');
    if (tut && tut.keep.indexOf(i) >= 0) classes.push('tut-target');
    if (shake && shake.kind === 'cell' && shake.id === i) classes.push('shake');
    if ((snap.phase === 'combo_eye' || snap.phase === 'blocked_eye') && snap.eyeOptions && snap.eyeOptions.indexOf(i) >= 0) classes.push('choosable');
    if (state.pulseCell === i) classes.push('pulse');
    boardHtml += '<div class="' + classes.join(' ') + '" data-cell="' + i + '">' + (die ? dieIcon(die.color, die.value, 50) : '') + mark + '</div>';
  }
  boardEl.innerHTML = boardHtml;
  state.pulseCell = null; // 튕김은 놓은 직후 한 번만
  state.dayCell = null;

  // 풀
  const poolEl = document.getElementById('pool');
  const poolClickable = !snap.isAiTurn && (snap.phase === 'place' || snap.phase === 'blocked_pool');
  poolEl.innerHTML = snap.pool.map(function (d, i) {
    let sel = snap.phase === 'place' && snap.selectedPi === i ? ' selected' : '';
    if (tut && tut.dice.indexOf(i) >= 0) sel += ' tut-target';
    else if (tut && tut.locked) sel += ' tut-dim';
    if (shake && shake.kind === 'die' && shake.id === i) sel += ' shake';
    return '<button class="die-btn' + sel + '" data-pi="' + i + '" ' + (poolClickable ? '' : 'disabled') + '>' + dieIcon(d.color, d.value, 54, { selected: snap.selectedPi === i }) + '</button>';
  }).join('');
  const nightLabel = state.mode === 'endless' ? nightDate(snap.night) + ' 밤' : snap.night + '/' + snap.maxNights + '번째 밤';
  let leftText = snap.done ? '' : ('이번 밤 남은 배치: ' + snap.placementsLeft + '번 · ' + nightLabel);
  if (snap.crackdown && !snap.done) {
    const cd = snap.crackdown;
    leftText = snap.phase === 'day' ? '낮 · 단속' : '이번 밤 손 ' + cd.hand + ' / ' + cd.handsPerNight + ' · 2개 중 ' + cd.pick + '개째';
  }
  document.getElementById('placements-left').textContent = leftText;

  // 기록지 · 이야기 (단속의 밤은 조각을 쓰지 않아 기록지를 숨긴다)
  document.getElementById('record-sheet').hidden = state.mode === 'crackdown';
  renderRecordSheet(snap.parts, snap.flags, snap.pushed);
  renderStoryPanel(snap);

  // 오버레이(모둠 순서 · 조각 고르기)
  const overlay = document.getElementById('overlay-panel');
  if (snap.isAiTurn || (tut && !g.overlayAllowed())) {
    overlay.hidden = true; // AI의 선택은 화면에 묻지 않는다. 첫 걸음은 설명하는 동안 숨긴다
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
        const tutCls = (tut && tut.rewards.indexOf(key) >= 0 ? ' tut-target' : '') + (shake && shake.kind === 'reward' && shake.id === key ? ' shake' : '');
        return '<button class="piece-btn' + (n === minCount ? ' need' : '') + tutCls + '" data-reward="' + key + '"><span class="ic">' + pieceIcon(key, 28, true) + '</span>' +
          PIECE_NAME[key] + '<span class="cnt">' + n + '개</span></button>';
      }).join('') + '</div>';
  } else {
    overlay.hidden = true;
  }

  if (snap.done && state.mode === 'tutorial') {
    // 첫 걸음: 남은 말풍선까지 다 넘기면 정리 카드로
    if (g.finished && state.tutFinishFor !== g) {
      state.tutFinishFor = g;
      setTimeout(function () { if (state.game === g && state.mode === 'tutorial') finishTutorialScene(); }, 900);
    }
  } else if (snap.done) {
    // 단속의 밤에서 태극기를 다 빼앗기면, 압수 연출을 잠깐 보여 준 뒤 넘어간다
    const delay = snap.crackdown && snap.crackdown.failed ? 1600 : 450;
    if (state.dawnFor !== g) { state.dawnFor = g; setTimeout(goToDawn, delay); }
  } else {
    announceTurn(snap);
    scheduleAi();
    scheduleDay(snap);
    showStoryPopup(snap);
  }
}

// 새 밤이 시작되어 내 차례가 돌아오면, 그 밤의 이야기(스무하루의 밤) · 단속 카드(단속의 밤)를 팝업으로 띄운다.
// 닫기를 눌러야 사라지고, 게임 화면의 이야기 · 예고 패널은 그대로 남는다. 밤마다 한 번만.
function showStoryPopup(snap) {
  let key = null, title, tag, body;
  if (snap.crackdown && snap.phase !== 'day') {
    key = 'cd-' + snap.night;
    const card = snap.crackdown.card;
    if (card) {
      const cells = card.cells.map(function (c) { return c + 1; });
      let mini = '';
      for (let i = 0; i < 9; i++) mini += '<span' + (card.cells.indexOf(i) >= 0 ? ' class="on"' : '') + '></span>';
      title = card.name;
      tag = nightOrdinal(snap.night) + ' 밤' + (card.period ? ' · ' + card.period : '') + ' · 오늘 낮 단속 ' + cells.join('·') + '번 칸';
      body = '<p>' + escapeHtml(card.background) + '</p>' +
        '<div class="story-cells"><div class="cd-mini" aria-hidden="true">' + mini + '</div>' +
        '<span>밤이 끝나면 표시된 칸이 비어 있을 때 밀정이 들어와 태극기 1장을 빼앗아 가요. 사람을 세워 지켜 주세요.</span></div>';
    } else {
      title = '마지막 밤';
      tag = nightOrdinal(snap.night) + ' 밤 · 낮 단속 없음';
      body = '<p>오늘 밤이 지나면 1919년 3월 1일이에요. 숨겨 둔 태극기를 끝까지 지켜 주세요.</p>';
    }
  } else if (state.mode === 'endless') {
    const cur = latestStory(snap.night);
    if (cur.night !== snap.night) return; // 이 밤에 새 이야기가 없으면 띄우지 않는다
    key = 'en-' + snap.night;
    title = cur.story.title;
    tag = nightDate(snap.night) + ' 밤 · ' + cur.story.period;
    body = cur.story.body;
  }
  if (!key || state.storyPopupKey === key) return;
  state.storyPopupKey = key;
  openInfoModal(title, tag, body, true);
}

// ------------------------------------------------------------------
// 단속의 밤 — 상태 줄 · 단속 예고 패널 · 장 수 연출 · 낮 진행
// ------------------------------------------------------------------
function renderCrackdown(snap) {
  const statusEl = document.getElementById('cd-status');
  const panelEl = document.getElementById('cd-panel');
  const on = !!snap.crackdown;
  statusEl.hidden = !on;
  panelEl.hidden = !on || snap.done;
  document.body.classList.toggle('is-day', on && snap.phase === 'day');
  if (!on) return;
  const cd = snap.crackdown;

  // 위쪽 상태 줄: 몇째 밤 · 숨겨 둔 태극기 · 빼앗긴 장 수 (연출용 .cd-fx는 다시 그려도 남도록 한 번만 만든다)
  if (!statusEl.firstChild) statusEl.innerHTML = '<div class="cd-row"></div><div class="cd-fx"></div>';
  statusEl.querySelector('.cd-row').innerHTML =
    '<span class="cd-night">' + nightOrdinal(snap.night) + ' 밤</span>' +
    '<span class="cd-hidden">' + taegeukgiFlag(24) + '숨겨 둔 태극기 <b>' + cd.hidden + '</b>장</span>' +
    '<span class="cd-seized">빼앗긴 ' + cd.seized + '장</span>';
  showCrackdownEvents(state.game.takeEvents());

  // 단속 예고 패널
  if (snap.done) return;
  const card = cd.card;
  let key, html;
  if (!card) {
    key = 'none-' + snap.night;
    html = '<div class="cd-info"><div class="cd-tag">오늘 밤이 지나면 3월 1일</div>' +
      '<div class="cd-name">이번 낮에는 단속이 없어요</div>' +
      '<div class="cd-bg">마지막 밤이에요. 숨겨 둔 태극기를 끝까지 지켜 주세요.</div></div>';
  } else {
    key = card.id + '-' + snap.night;
    const passed = cd.day ? cd.day.results.map(function (r) { return r.cell; }) : [];
    let mini = '';
    for (let i = 0; i < 9; i++) {
      const cls = card.cells.indexOf(i) >= 0 ? 'on' + (passed.indexOf(i) >= 0 ? ' past' : '') : '';
      mini += '<span' + (cls ? ' class="' + cls + '"' : '') + '></span>';
    }
    html = '<div class="cd-mini" aria-hidden="true">' + mini + '</div>' +
      '<div class="cd-info"><div class="cd-tag">' + (cd.day ? '낮 단속 중' : '오늘 낮 단속 예고') +
      ' · ' + card.cells.map(function (c) { return c + 1; }).join('·') + '번 칸</div>' +
      '<div class="cd-name">' + escapeHtml(card.name) + '</div>' +
      '<div class="cd-bg">' + (card.period ? escapeHtml(card.period) + ' · ' : '') + escapeHtml(card.background) + '</div></div>';
  }
  panelEl.innerHTML = html;
  panelEl.classList.toggle('day', !!cd.day);
  if (panelEl.dataset.key !== key) {
    panelEl.dataset.key = key;
    panelEl.classList.remove('fresh');
    void panelEl.offsetWidth; // 애니메이션을 처음부터 다시
    panelEl.classList.add('fresh');
  }
}

// 장 수가 바뀌면 상태 줄 위로 +2장 / -1장이 떠오르고, 모둠 · 손에서 놓은 밀정은 토스트로 알린다
// (낮 단속의 압수 토스트는 dayTick이 카드 이름과 함께 띄운다)
function showCrackdownEvents(events) {
  if (!events.length) return;
  let delta = 0;
  const msgs = [];
  events.forEach(function (e) {
    if (e.type === 'gain') { delta += e.flags; msgs.push(COMBO_NAME[e.combo] + ' — 태극기 ' + e.flags + '장을 숨겼어요'); }
    if (e.type === 'seize') { delta -= e.flags; if (e.reason === 'self') msgs.push('밀정이 끼어들었어요 — 태극기 ' + e.flags + '장 압수'); }
  });
  if (msgs.length) toast(msgs.join(' · '));
  if (delta === 0) return;
  const fx = document.querySelector('#cd-status .cd-fx');
  const el = document.createElement('div');
  el.className = 'cd-float' + (delta < 0 ? ' minus' : '');
  el.textContent = (delta > 0 ? '+' : '') + delta + '장';
  fx.appendChild(el);
  setTimeout(function () { el.remove(); }, 1400);
  const pill = document.querySelector('#cd-status .cd-hidden');
  if (pill) pill.classList.add('bump');
}

// 낮: "날이 밝았어요" → 표시 칸마다 한 칸씩(밀정 등장 또는 지켜 냄) → 다음 밤의 첫 손
function scheduleDay(snap) {
  if (!snap.crackdown || snap.phase !== 'day' || state.dayTimer) return;
  const first = snap.crackdown.day.results.length === 0;
  state.dayTimer = setTimeout(dayTick, first ? 1500 : 1200);
}

function dayTick() {
  state.dayTimer = null;
  const g = state.game;
  if (!(g instanceof CrackdownGame) || g.phase !== 'day' || !document.getElementById('screen-game').classList.contains('active')) return;
  if (g.dayPending) {
    const card = g.dayState.card;
    const r = g.dayStep();
    state.dayCell = { cell: r.cell, kind: r.kind };
    if (r.kind === 'spy') {
      let msg = card.name + ' — 태극기 ' + r.seized + '장 압수';
      if (r.scattered.length) msg += ' · 줄이 흩어졌어요';
      if (r.withdrawn.length) msg += ' · 감시 철수';
      toast(msg);
      let d = 0;
      const next = function (name, gap) { Sound.play(name, d); d += Sound.span(name) + gap; };
      next('place', 0.15);
      next('blocked', 0.2);
      if (r.scattered.length) next('scatter', 0.2);
      if (r.withdrawn.length) next('withdraw', 0.2);
    } else if (r.kind === 'guarded') {
      toast((r.cell + 1) + '번 칸 — 사람이 지켜 냈어요');
      Sound.play('select');
    } else {
      toast((r.cell + 1) + '번 칸 — 주머니가 비어 밀정이 오지 않았어요');
    }
  } else {
    g.endDay();
    Sound.play('night');
    const c = g.card;
    toast(nightOrdinal(g.night) + ' 밤 — ' + (c ? '오늘 낮 단속 예고: ' + c.name : '마지막 밤이에요'));
  }
  renderGame();
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

// 안내 팝업(이야기 카드 · 단속 카드 공용): 제목 · 강조 한 줄 · 본문 HTML
// buttonOnly: 바깥을 눌러도 닫히지 않고 닫기 버튼으로만 닫힘(밤마다 뜨는 이야기 팝업)
function openInfoModal(title, tag, bodyHtml, buttonOnly) {
  document.getElementById('info-modal-title').textContent = title;
  document.getElementById('info-modal-tag').textContent = tag;
  document.getElementById('info-modal-body').innerHTML = bodyHtml;
  document.getElementById('info-modal').hidden = false;
  document.getElementById('info-modal').dataset.buttonOnly = buttonOnly ? '1' : '';
  // 닫기 버튼에 초점을 주되, 긴 내용(규칙 한눈에 등)이 아래로 밀려 내려가지 않게 맨 위부터 보여 준다
  document.getElementById('info-modal-close').focus({ preventScroll: true });
  document.querySelector('#info-modal .modal-card').scrollTop = 0;
}

function closeInfoModal() {
  document.getElementById('info-modal').hidden = true;
}

function renderRecordSheet(parts, flagsDone, pushed) {
  document.getElementById('record-sheet').innerHTML = recordSheetHtml(parts, flagsDone, pushed);
}

// 기록지: 태극 · 건 · 리 · 감 · 곤 다섯 칸 줄을 쌓은 모양(게임 화면 · 조각 고르는 창에서 함께 씀)
// 룰북 「조각 기록하기」: 기록지에는 태극기 4장이 있고, 조각은 1번 태극기부터 그 조각의 빈자리에 찍는다.
// 그래서 k번 줄의 한 자리는 그 조각을 k개 이상 모았을 때 찍혀 있다. 4장을 다 채우고도 더 들어온 조각은 넘친 조각.
// 엔진은 다섯 조각이 모일 때마다 태극기로 세므로(4장 제한 없음), 완성한 장수가 4를 넘으면 그만큼 줄을 더 보여 준다.
const RECORD_FLAGS = 4;
function recordSheetHtml(parts, flagsDone, pushed) {
  const most = Math.max.apply(null, PIECE_ORDER.map(function (k) { return parts[k] || 0; }));
  const rowCount = Math.max(flagsDone || 0, Math.min(RECORD_FLAGS, Math.max(1, most)));
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    rows.push(PIECE_ORDER.map(function (k) { return { key: k, filled: (parts[k] || 0) > r }; }));
  }
  const counts = {};
  PIECE_ORDER.forEach(function (k) { counts[k] = Math.max(0, (parts[k] || 0) - rowCount); });
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
  if (state.mode === 'tutorial') tutorialEventToast(before, after);
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

// 첫 걸음: 방금 일어난 일(모둠 · 흩어짐 · 감시 철수 · 밀정 쫓아냄)의 이름을 짧게 띄운다
function tutorialEventToast(before, after) {
  const b = before.stats, a = after.stats;
  const msgs = [];
  if (a.cross > b.cross) msgs.push('교차 완성!');
  ['color', 'consec', 'same'].forEach(function (k) { if (a[k] > b[k]) msgs.push(COMBO_NAME[k] + '!'); });
  if (a.eyesRemoved > b.eyesRemoved) msgs.push('밀정을 쫓아냄 +1');
  if (a.scatterLines > b.scatterLines) msgs.push('흩어짐');
  if (a.withdrawn > b.withdrawn) msgs.push('감시 철수');
  if (after.flags > before.flags) msgs.push('태극기 완성 +1');
  if (msgs.length) toast(msgs.join(' · '));
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
    if (snap.validCells.indexOf(cell) < 0 && state.mode !== 'tutorial') return;
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
  const stars = g.starsEarned();
  state.endlessResult = state.mode === 'endless' ? saveEndlessResult(g.score, g.completed ? g.maxNights : g.night) : null;
  state.crackdownResult = state.mode === 'crackdown' ? saveCrackdownResult(g.finished ? g.hidden : 0, stars) : null;
  const crackdownFailed = state.mode === 'crackdown' && g.failed;

  showScreen('dawn');
  if (g.endReason === 'sealed' || crackdownFailed) { Sound.play('scatter'); Sound.play('dawn', 1.0); }
  else Sound.play('dawn');
  document.getElementById('dawn-result').hidden = true;
  document.getElementById('dawn-skip').hidden = false;
  const sky = document.getElementById('dawn-sky');
  sky.style.background = '#141a2b';
  document.getElementById('dawn-caption').textContent = g.endMessage();
  setTimeout(function () {
    sky.style.background = crackdownFailed ? 'linear-gradient(180deg, #2b2a3a, #6b5550, #b98763)' : 'linear-gradient(180deg, #b98763, #ebb866, #f8ecd2)';
  }, 120);

  // 완성한 태극기 장 수만큼 빛바랜 태극기를 걸고, 누르면 색이 들어온다.
  // 자유 연습은 룰북 §9 행렬 세우기: 맨 앞 지방이 태극기 한 장을 든다.
  const flagCount = state.mode === 'practice' ? 0 : g.flags;
  state.dawnPending = [];
  const paintArea = document.getElementById('dawn-paint-area');
  if (state.mode === 'crackdown') {
    // 끝까지 지켜 냈으면 태극기 한 장을 크게 들고, 손에 든 장 수를 함께 적는다
    paintArea.innerHTML = g.finished
      ? '<div class="dawn-flag">' + taegeukgiFlag(150) + '<div class="cap">손에 든 태극기 <b>' + g.hidden + '</b>장</div></div>'
      : '';
    showDawnResult();
  } else if (state.mode === 'practice') {
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
  } else if (state.mode === 'crackdown') {
    document.getElementById('dawn-score-line').innerHTML = g.finished
      ? '<div class="cd-sub">빼앗긴 태극기 ' + g.seized + '장</div>' +
        '<div class="cd-sub">그래도 우리가 만든 태극기 ' + g.made + '장</div>' +
        '<div class="cd-main">오늘, 손에 든 태극기 ' + g.hidden + '장으로 만세를 부릅니다.</div>'
      : '<div class="cd-main">숨겨 둔 태극기를 모두 빼앗겼어요</div>';
    rankingEl.hidden = true;
  } else {
    document.getElementById('dawn-score-line').textContent = g.score + '점 · 태극기 ' + g.flags + '장';
    rankingEl.hidden = true;
  }

  const starsLineEl = document.getElementById('dawn-stars-line');
  const goalLineEl = document.getElementById('dawn-goal-line');
  starsLineEl.classList.remove('record');
  if (state.mode === 'practice') {
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
  } else if (state.mode === 'crackdown') {
    const r = state.crackdownResult;
    const at = g.failedAt;
    if (g.finished) {
      starsLineEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      starsLineEl.hidden = false;
      const st = CRACKDOWN_CONFIG.STARS;
      goalLineEl.textContent = (r.isNew ? '새 최고 기록! · ' : '') + '최고 기록 ' + r.best.flags + '장 · ' + '★'.repeat(r.best.stars) + '☆'.repeat(3 - r.best.stars) +
        ' (★' + st[0] + '장 ★★' + st[1] + '장 ★★★' + st[2] + '장)';
    } else {
      starsLineEl.hidden = true;
      goalLineEl.textContent = nightOrdinal(at.night) + ' 밤' + (at.when === 'day' ? ' 낮' : '') + '에 끝났어요 · 빼앗긴 ' + g.seized + '장 · 만든 ' + g.made + '장' +
        (r.best.flags > 0 ? ' · 최고 기록 ' + r.best.flags + '장' : '');
    }
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

// ------------------------------------------------------------------
// 초기화 · 이벤트 연결
// ------------------------------------------------------------------
function wireStaticEvents() {
  document.body.addEventListener('click', function (e) {
    const info = e.target.closest('[data-info]');
    if (info) { Sound.play('tap'); openModeSheet(info.dataset.info); return; }
    if (e.target.closest('#mode-sheet-close') || e.target.id === 'mode-sheet') { closeModeSheet(); return; }
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      closeModeSheet();
      Sound.play('tap');
      const target = nav.dataset.nav;
      if (target === 'tutorial') renderTutorialHome();
      if (target === 'rules') renderRules();
      if (target === 'settings') renderSettings();
      if (target === 'practice-setup') renderPracticeSetup();
      if (target === 'endless-start') { startGame(makeEndlessLevel(), 'endless'); return; }
      if (target === 'crackdown-start') { startCrackdown(); return; }
      showScreen(target);
      return;
    }
    const tutStart = e.target.closest('[data-tut-start]');
    if (tutStart && !tutStart.disabled) { Sound.play('tap'); startTutorialScene(Number(tutStart.dataset.tutStart)); return; }
    const tutBtn = e.target.closest('[data-tut]');
    if (tutBtn) { onTutorialAction(tutBtn.dataset.tut); return; }
    const tutDie = e.target.closest('[data-tut-die]');
    if (tutDie) { onTutorialDieClick(Number(tutDie.dataset.tutDie)); return; }
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
    const rollBtn = e.target.closest('[data-roll]');
    if (rollBtn && !rollBtn.disabled) { rollFor(Number(rollBtn.dataset.roll)); return; }
    if (e.target.closest('#btn-roll-start')) { Sound.play('tap'); startPracticeWithOrder(); return; }
    if (e.target.closest('#btn-night-story')) {
      document.getElementById('story-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('#info-modal-close')) { closeInfoModal(); return; }
    if (e.target.id === 'info-modal') { if (!e.target.dataset.buttonOnly) closeInfoModal(); return; }
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
    const msg = state.mode === 'tutorial' ? '장면을 나가면 다음에 이 장면을 처음부터 다시 해요. 나가시겠어요?' : '지금 나가면 이번 밤의 진행은 저장되지 않아요. 나가시겠어요?';
    if (confirm(msg)) {
      showScreen(state.returnScreen);
      if (state.returnScreen === 'tutorial') renderTutorialHome();
    }
  });

  document.getElementById('btn-tut-card-exit').addEventListener('click', function () {
    Sound.play('tap');
    showScreen('tutorial');
    renderTutorialHome();
  });

  // 게임 중 [규칙]: 모둠(조합) 규칙과 점수 규칙을 팝업으로(단속의 밤은 태극기 장 수)
  document.getElementById('btn-game-rules').addEventListener('click', function () {
    Sound.play('tap');
    ensureQuickRulesStyle();
    const cd = state.mode === 'crackdown';
    openInfoModal('규칙 한눈에', cd ? '모둠 · 숨겨 둔 태극기' : '모둠 · 점수',
      quickRulesHtml({ crackdown: cd, crackdownFlags: CRACKDOWN_CONFIG.FLAGS_PER_COMBO }));
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
    if (state.mode === 'practice') openFirstRoll(state.practiceSeats);
    else if (state.mode === 'endless') startGame(makeEndlessLevel(), 'endless');
    else if (state.mode === 'crackdown') startCrackdown();
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
    const modal = document.getElementById('info-modal');
    if (e.key === 'Escape' && !modal.hidden && !modal.dataset.buttonOnly) closeInfoModal();
    if (e.key === 'Escape') closeModeSheet();
  }, { capture: true });
  document.addEventListener('visibilitychange', function () { Sound.setHidden(document.hidden); });
}

async function loadCrackdownCards() {
  const res = await fetch('data/crackdown.json');
  const cards = await res.json();
  // 카드의 이름 · 시기 · 배경 글은 texts/crackdown.md에 있다
  cards.stories.forEach(function (s) {
    s.name = tText('cd.' + s.id + '.name');
    s.period = tText('cd.' + s.id + '.period');
    s.background = tText('cd.' + s.id + '.background');
  });
  state.crackdownCards = cards;
}

// 단속의 밤: 카드를 아직 못 불러왔으면 한 번 더 시도한다
async function startCrackdown() {
  if (!state.crackdownCards) {
    try { await loadCrackdownCards(); } catch (e) { /* 아래에서 알림 */ }
  }
  if (!state.crackdownCards) { toast('단속 카드를 불러오지 못했어요.'); return; }
  startGame(makeCrackdownLevel(), 'crackdown');
}

async function init() {
  requestPersistentStorage();
  applySoundSettings();
  renderTitleFlag();
  showScreen('title');
  // 게임 속 글(texts/*.md)을 먼저 읽는다. 읽기 전에는 버튼을 눌러도 반응하지 않게, 다 읽은 뒤에 입력을 연결한다
  await loadTexts();
  buildStories();
  fillTextSlots(document); // 처음 화면 메뉴의 한 줄 설명 등 data-text 자리
  wireStaticEvents();
  try { await loadCrackdownCards(); } catch (e) { /* 단속의 밤을 시작할 때 다시 시도 */ }
  registerServiceWorker();
}

init();
