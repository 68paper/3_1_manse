/*
 * js/solo.js — 1인 모드 진행
 * ------------------------------------------------------------------
 * engine.js(판정 로직)를 그대로 가져다 쓰고, 여기서는:
 *   - 레벨 데이터를 엔진 설정으로 바꿔 게임을 만들고
 *   - 화면(ui.js)이 지금 무엇을 보여줘야 하는지 계산하고
 *   - 화면에서 올라온 선택(주사위 놓기 · 남기기 · 감시의 눈 · 조각 · 배치불가 처리)을
 *     엔진 함수에 그대로 전달한다.
 *
 * 중요: Engine.place()는 "조합 없음/교차 완성"일 때 finalizePlacement()/prepareCross()의
 * 반환값(undefined)을 그대로 돌려준다. 그래서 성공 여부는 `=== false` 로만 판정해야 한다.
 * (원본 v0.9.9 엔진의 특성이며, 여기서는 그 특성에 맞춰 호출부만 정확히 쓴다.)
 */
import { Engine } from './engine.js';
import { buildSoloSettings, applyStartEyes, isBlockedStart, randomSeed } from './levelSetup.js';

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
 * mode: 'practice' | 'campaign'
 */
export class SoloGame {
  constructor(level, mode, opts) {
    this.mode = mode;
    this.level = level;
    this.opts = opts || {};
    this.selectedPi = null; // 화면에서 고른, 아직 놓지 않은 주사위의 풀 인덱스
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
  get board() { return this.g.players[0].board; }
  get pool() { return this.g.pool; }
  get night() { return this.g.round; }
  get maxNights() { return this.g.settings.maxRounds; }
  get placementsLeft() { return 2 - this.g.placementsThisTurn; }
  get score() { return Engine.finalStats(this.g)[0].score; }
  get parts() { return this.g.players[0].parts; }
  get flags() { return Engine.flagsOf(this.g.players[0]); }
  get pieces() { return Engine.pieceTotal(this.g.players[0]); }
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
      score: this.score, parts: this.parts, flags: this.flags, pieces: this.pieces,
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
      case 'combo_order': return '두 무리가 함께 이루어졌어요. 어느 쪽을 먼저 처리할까요?';
      case 'combo_keep': return '무리 중 남길 한 사람을 골라 주세요.';
      case 'combo_eye': return '밀어낼 감시의 눈을 골라 주세요.';
      case 'combo_reward': return '받을 조각을 골라 주세요.';
      case 'blocked_pool': return '이번엔 놓을 곳이 없어요. 돌려보낼 사람을 골라 주세요.';
      case 'blocked_eye': return '치울 감시의 눈을 골라 주세요.';
      case 'end': return '여덟 번째 등잔이 꺼졌습니다.';
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
    return result !== false;
  }
  chooseComboOrder(idx) { return Engine.chooseComboOrder(this.g, idx); }
  chooseKeep(cell) { return Engine.chooseKeep(this.g, cell); }
  chooseEye(cell) { return Engine.chooseComboEye(this.g, cell); }
  chooseReward(key) { return Engine.chooseReward(this.g, key); }
  resolveBlockedPool(pi) { return Engine.resolveBlockedPool(this.g, pi); }
  removeBlockedEye(cell) { return Engine.removeBlockedEye(this.g, cell); }

  /**
   * 별1 목표의 현재 진행. { type, current, target, met }
   * noScatter는 끝날 때까지 지켜야 하므로 current = 흩어진 줄 수, target = 0.
   */
  goalProgress() {
    const stars = this.level.stars || [];
    const stats = this.g.players[0].stats;
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

/** 자유 연습: 매번 새 무작위 시드, 기본 조건(풀4 · 여덟 밤) */
export function makePracticeLevel() {
  return {
    id: 'practice', region: '자유 연습', title: '자유 연습',
    nights: 8, poolSize: 4, seed: randomSeed(),
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
