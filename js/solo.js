/*
 * js/solo.js — 1인 모드 진행
 * ------------------------------------------------------------------
 * engine.js(판정 로직)를 그대로 가져다 쓰고, 여기서는:
 *   - 레벨 데이터를 엔진 설정으로 바꿔 게임을 만들고
 *   - 화면(ui.js)이 지금 무엇을 보여줘야 하는지 계산하고
 *   - 화면에서 올라온 선택(주사위 놓기 · 남기기 · 밀정 · 조각 · 배치불가 처리)을
 *     엔진 함수에 그대로 전달한다.
 *
 * 중요: Engine.place()는 "조합 없음/교차 완성"일 때 finalizePlacement()/prepareCross()의
 * 반환값(undefined)을 그대로 돌려준다. 그래서 성공 여부는 `=== false` 로만 판정해야 한다.
 * (원본 v0.9.9 엔진의 특성이며, 여기서는 그 특성에 맞춰 호출부만 정확히 쓴다.)
 */
import { Engine } from './engine.js';
import { buildSoloSettings, applyStartEyes, isBlockedStart, randomSeed } from './levelSetup.js';
import { nightDate } from './story.js';

const STORAGE_PREFIX = 'manse-eve:v1:';

function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}

export const PIECE_NAME = { taegeuk: '태극', geon: '건', ri: '리', gam: '감', gon: '곤' };
export const PIECE_ORDER = ['taegeuk', 'geon', 'ri', 'gam', 'gon'];

/**
 * SoloGame — 화면(ui.js)이 쓰는 얇은 래퍼.
 * mode: 'campaign' | 'endless' (여럿이 하는 자유 연습은 multi.js의 MultiGame이 이 클래스를 확장)
 * 판 · 조각 · 점수 등은 모두 '지금 화면에 보이는 플레이어'(this.player) 기준이다. 1인 모드에서는 항상 0번.
 */
export class SoloGame {
  constructor(level, mode, opts) {
    this.mode = mode;
    this.level = level;
    this.opts = opts || {};
    this.selectedPi = null; // 화면에서 고른, 아직 놓지 않은 주사위의 풀 인덱스
    this.endReason = null;  // 스무하루의 밤 중도 종료 이유: 'sealed'(막힌 판) | 'quit'(종료 버튼). 21밤을 다 넘기면 null
    this._buildAndStart();
  }

  _buildAndStart() {
    const settings = buildSoloSettings(this.level, 'human');
    const g = Engine.create(settings);
    applyStartEyes(Engine, g, this.level.startEyes);
    Engine.startRound(g);
    this.g = g;
    this.selectedPi = null;
  }

  // ---- 조회 ----
  get player() { return this.g.players[0]; }
  get playerId() { return this.player.id; }
  get board() { return this.player.board; }
  get pool() { return this.g.pool; }
  get night() { return this.g.round; }
  get maxNights() { return this.g.settings.maxRounds; }
  get placementsLeft() { return 2 - this.g.placementsThisTurn; }
  get score() { return Engine.scoreOf(this.player); }
  get parts() { return this.player.parts; }
  get flags() { return Engine.flagsOf(this.player); }
  get pieces() { return Engine.pieceTotal(this.player); }
  get pushed() { return this.player.pushed || 0; } // 한뜻으로 쫓아낸 밀정(1개당 1점)
  get done() { return this.g.done; }
  get phase() { return this.g.phase; }

  /** 지금 놓을 수 있는 칸(놓을 주사위를 고르지 않았어도 배치 규칙만) */
  validCells() { return Engine.validCells(this.board); }
  /** 특정 주사위를 특정 칸에 놓으면 그 자리에서 흩어지는지(도움 표시용) */
  wouldScatterAt(pi, cell) {
    const die = this.pool[pi];
    if (!die) return false;
    return Engine.wouldScatter(this.board, cell, die);
  }

  /** 화면이 지금 그려야 할 상태를 한 번에 반환 */
  snapshot() {
    const g = this.g;
    const base = {
      mode: this.mode, level: this.level,
      board: this.board, pool: this.pool,
      night: this.night, maxNights: this.maxNights,
      placementsLeft: this.placementsLeft,
      score: this.score, parts: this.parts, flags: this.flags, pieces: this.pieces, pushed: this.pushed,
      phase: g.phase, done: g.done,
      selectedPi: this.selectedPi,
      validCells: this.done ? [] : this.validCells(),
      message: this._messageFor(g.phase)
    };
    if (g.phase === 'combo_order') base.comboOrderOptions = g.pending.combos.map((c, i) => ({ idx: i, line: c.line, type: c.type }));
    if (g.phase === 'combo_keep') base.keepLine = g.pending.combo.line;
    if (g.phase === 'combo_eye') base.eyeOptions = g.pending.eyeOptions;
    if (g.phase === 'combo_reward') base.rewardOptions = g.pending.rewardOptions;
    if (g.phase === 'blocked_pool') base.poolAll = g.pool;
    if (g.phase === 'blocked_eye') base.eyeOptions = g.pending.eyeOptions;
    return base;
  }

  _messageFor(phase) {
    switch (phase) {
      case 'place': return this.placementsLeft === 2 ? '이번 밤, 놓을 사람을 골라 주세요.' : '한 번 더 놓아 주세요.';
      case 'combo_order': return '두 모둠이 함께 이루어졌어요(교차 완성). 어느 쪽 보상을 먼저 받을까요?';
      case 'combo_keep': return '모둠 중 남길 한 사람을 골라 주세요.';
      case 'combo_eye': return '쫓아낼 밀정을 골라 주세요. (+1점)';
      case 'combo_reward': return '받을 조각을 골라 주세요.';
      case 'blocked_pool': return '이번엔 놓을 곳이 없어요. 돌려보낼 사람을 골라 주세요.';
      case 'blocked_eye': return '치울 밀정을 골라 주세요.';
      case 'end': return this.endMessage();
      default: return '';
    }
  }

  // ---- 행동 ----
  selectDie(pi) {
    if (this.g.phase !== 'place') return false;
    this.selectedPi = (this.selectedPi === pi) ? null : pi;
    return true;
  }
  placeAt(cell) {
    if (this.g.phase !== 'place' || this.selectedPi == null) return false;
    const pi = this.selectedPi;
    this.selectedPi = null;
    const result = Engine.place(this.g, pi, cell);
    this._checkSealed();
    return result !== false;
  }
  chooseComboOrder(idx) { const r = Engine.chooseComboOrder(this.g, idx); this._checkSealed(); return r; }
  chooseKeep(cell) { const r = Engine.chooseKeep(this.g, cell); this._checkSealed(); return r; }
  chooseEye(cell) { const r = Engine.chooseComboEye(this.g, cell); this._checkSealed(); return r; }
  chooseReward(key) { const r = Engine.chooseReward(this.g, key); this._checkSealed(); return r; }
  resolveBlockedPool(pi) { const r = Engine.resolveBlockedPool(this.g, pi); this._checkSealed(); return r; }
  removeBlockedEye(cell) { const r = Engine.removeBlockedEye(this.g, cell); this._checkSealed(); return r; }

  /** 스무하루의 밤: 종료 버튼 — 지금까지의 점수로 끝낸다 */
  quit() {
    if (this.g.done) return false;
    this.selectedPi = null;
    this.endReason = 'quit';
    Engine.endGame(this.g);
    return true;
  }

  /** 스무하루의 밤: 판이 막혔는지(가로 · 세로 모든 줄에 밀정) */
  isSealed() {
    const eyes = [];
    this.board.forEach(function (d, i) { if (d && d.value === 1) eyes.push(i); });
    return isBlockedStart(eyes);
  }

  // 모둠 처리 도중(남기기 · 조각 고르기)에는 판이 잠깐 가득 찬 상태라 판단하지 않고,
  // 한 번의 배치가 다 끝나 다음 행동을 기다릴 때만 막힌 판을 확인한다.
  _checkSealed() {
    if (this.mode !== 'endless' || this.g.done) return;
    if (this.g.phase !== 'place' && this.g.phase !== 'blocked_pool') return;
    if (this.isSealed()) {
      this.selectedPi = null;
      this.endReason = 'sealed';
      Engine.endGame(this.g);
    }
  }

  /** 스무하루의 밤을 끝까지(3월 1일 새벽까지) 버텼는지 */
  get completed() { return this.mode === 'endless' && this.g.done && !this.endReason; }

  endMessage() {
    if (this.mode !== 'endless') return '여덟 번째 등잔이 꺼졌습니다.';
    if (this.endReason === 'sealed') return nightDate(this.night) + ' 밤, 밀정이 판을 막았습니다.';
    if (this.endReason === 'quit') return nightDate(this.night) + ' 밤에서 멈췄습니다.';
    return '1919년 3월 1일, 날이 밝았습니다.';
  }

  /**
   * 별1 목표의 현재 진행. { type, current, target, met }
   * noScatter는 끝날 때까지 지켜야 하므로 current = 흩어진 줄 수, target = 0.
   */
  goalProgress() {
    const stars = this.level.stars || [];
    const stats = this.player.stats;
    const goal = this.level.goal || { type: 'score' };
    let current, target, met;
    if (goal.type === 'flags') { current = this.flags; target = goal.count || 1; met = current >= target; }
    else if (goal.type === 'combo') { current = stats[goal.combo] || 0; target = goal.count || 1; met = current >= target; }
    else if (goal.type === 'noScatter') { current = stats.scatterLines; target = 0; met = current === 0; }
    else { current = this.score; target = stars.length ? stars[0] : 1; met = current >= target; }
    return { type: goal.type, combo: goal.combo, current: current, target: target, met: met };
  }

  /** 결과 화면용 별 계산: 별1 = 목표 달성, 별2·3 = 점수 기준(stars[1], stars[2]) */
  starsEarned() {
    const stars = this.level.stars || [];
    const a1 = this.goalProgress().met;
    const a2 = stars.length > 1 ? this.score >= stars[1] : false;
    const a3 = stars.length > 2 ? this.score >= stars[2] : false;
    return (a1 ? 1 : 0) + (a2 ? 1 : 0) + (a3 ? 1 : 0);
  }
}

// ---------------------------------------------------------------------
// 모드별 레벨 만들기
// ---------------------------------------------------------------------

/** 자유 연습: 매번 새 무작위 시드, 여덟 밤. 풀 크기는 MultiGame이 인원×2+2(원본 규칙)로 정한다 */
export function makePracticeLevel() {
  return {
    id: 'practice', region: '자유 연습', title: '자유 연습',
    nights: 8, poolSize: null, seed: randomSeed(),
    eyeChance: null, startEyes: [], scriptedPools: null,
    goal: { type: 'score' }, stars: null
  };
}

/**
 * 스무하루의 밤: 1919년 2월 8일 ~ 2월 28일, 21밤. 밤마다 그 무렵의 이야기 카드(js/story.js)가 나온다.
 * 21밤을 넘기면 3월 1일 새벽. 그 전에 판이 막히거나 종료 버튼을 누르면 그때까지의 점수로 끝.
 */
export function makeEndlessLevel() {
  return {
    id: 'endless', region: '스무하루의 밤', title: '스무하루의 밤',
    nights: 21, poolSize: 4, seed: randomSeed(),
    eyeChance: null, startEyes: [], scriptedPools: null,
    goal: { type: 'score' }, stars: null
  };
}

// ---------------------------------------------------------------------
// 저장(localStorage) — 모든 읽기/쓰기 try/catch, 키 접두사 manse-eve:v1:
// ---------------------------------------------------------------------

export function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) { /* 무시 */ }
}

export function getSettings() {
  return storageGet('settings', { hints: true });
}
/** 바뀐 설정 객체를 돌려준다(저장에 실패해도 이번 실행 동안은 반영되도록) */
export function setSettings(patch) {
  const next = Object.assign({}, getSettings(), patch);
  storageSet('settings', next);
  return next;
}

// 자유 연습 자리 구성: { count: 3~5, seats: [{ type: 'human'|'ai', name }] } — 다음에 열면 그대로 복원
const DEFAULT_PRACTICE_SETUP = {
  count: 3,
  seats: [
    { type: 'human', name: '' }, { type: 'ai', name: '' }, { type: 'ai', name: '' },
    { type: 'ai', name: '' }, { type: 'ai', name: '' }
  ]
};
export function getPracticeSetup() {
  const s = storageGet('practiceSetup', null);
  if (!s || !Array.isArray(s.seats) || s.seats.length !== 5) return JSON.parse(JSON.stringify(DEFAULT_PRACTICE_SETUP));
  if (!(s.count >= 3 && s.count <= 5)) s.count = 3;
  return s;
}
export function savePracticeSetup(setup) {
  storageSet('practiceSetup', setup);
}
/** 써 본 사람 이름(최근 순, 최대 12개) — 이름 입력칸의 추천 목록 */
export function getSavedNames() {
  return storageGet('savedNames', []);
}
export function addSavedNames(names) {
  const cur = getSavedNames();
  const next = names.concat(cur.filter(function (n) { return names.indexOf(n) < 0; })).slice(0, 12);
  storageSet('savedNames', next);
  return next;
}

export function getCampaignProgress() {
  // { [levelId]: { stars: 0-3, bestScore: n } }
  return storageGet('campaign', {});
}
export function saveCampaignResult(levelId, stars, score) {
  const prog = getCampaignProgress();
  const cur = prog[levelId] || { stars: 0, bestScore: 0 };
  prog[levelId] = { stars: Math.max(cur.stars, stars), bestScore: Math.max(cur.bestScore, score) };
  storageSet('campaign', prog);
  return prog[levelId];
}
export function isLevelUnlocked(levels, levelId) {
  const idx = levels.findIndex(function (l) { return l.id === levelId; });
  if (idx <= 0) return true;
  const prog = getCampaignProgress();
  const prevId = levels[idx - 1].id;
  return !!(prog[prevId] && prog[prevId].stars >= 1);
}

/** 스무하루의 밤 기록. { score, nights } 최고 점수 하나만 보관 (밤 제한이 없던 시절 기록 'endless'와 구분) */
export function getEndlessBest() {
  return storageGet('endless21', null);
}
/** 결과를 기록하고 { best, isNew }를 돌려준다(같은 점수면 더 오래 버틴 쪽) */
export function saveEndlessResult(score, nights) {
  const cur = getEndlessBest();
  const isNew = !cur || score > cur.score || (score === cur.score && nights > cur.nights);
  const best = isNew ? { score: score, nights: nights } : cur;
  if (isNew) storageSet('endless21', best);
  return { best: best, isNew: isNew };
}
