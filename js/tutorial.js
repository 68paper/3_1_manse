/*
 * js/tutorial.js — 첫 걸음(하나로 이어지는 과정)
 * ------------------------------------------------------------------
 * 기획: docs/첫걸음_개편_시나리오.md
 *
 * 장면 하나에 개념 하나. 장면은 세 종류다.
 *   story : 이야기 카드를 넘긴다(장면 0 · 끝)
 *   dice  : 주사위를 눌러 사람과 밀정을 알아본다(장면 1)
 *   play  : 미리 짜 둔 판에서 코치 말풍선을 따라 직접 놓는다(장면 2 - 12)
 *
 * play 장면은 엔진(engine.js)을 그대로 쓴다. 여기서 더하는 것은
 *   - 시작 판(startBoard: 칸마다 색 · 눈)과 시작 기록지(startRecord)
 *   - 단계(steps): 말풍선 · 고를 주사위와 칸 · 퀴즈 · 틀렸을 때의 힌트
 * 뿐이다. 틀린 선택은 엔진에 넘기지 않고 막은 뒤 힌트를 준다.
 *
 * 단계 모양
 *   { next: true }                            [다음]을 누르면 넘어감
 *   { next: true, act: 'keepPlaced' }         [다음]을 누르면 방금 놓은 주사위를 남김(남기기를 배우기 전 장면)
 *   { move: { die, cell, quiz } }
 *        die: [색, 눈] 또는 null(아무나), cell: 칸 번호 또는 null(놓을 수 있는 아무 칸)
 *        quiz: true면 처음엔 정답을 강조하지 않고, 두 번 틀리면 강조
 *   { keep: 칸 번호 | null, quiz }
 *   { reward: 조각 | null, quiz }             조각을 다 받을 때까지(교차 완성이면 두 모둠 모두)
 *   { order: true }                           교차 완성의 보상 순서 고르기
 *
 * 글(말풍선 · 힌트 · 장면 이름 · 정리 카드)은 texts/tutorial.md에 있다. 아이디는 '장면 아이디.단계 번호'.
 *   장면.N.say          N단계 말풍선           장면.N.place    주사위를 고른 뒤 말풍선(있으면)
 *   장면.N.hint.die     다른 주사위를 골랐을 때  장면.N.hint.die.blue6  그 주사위를 골랐을 때(있으면 먼저)
 *   장면.N.hint.cell · .hint.invalid · .hint.keep · .hint.reward
 *   단계 힌트가 없으면 common.hint.* 를 쓴다. 단계를 끼워 넣으면 뒤 단계 번호가 밀리므로 글 파일도 함께 고친다
 *   (tools/validate-texts.mjs가 빠진 글 · 남는 글을 알려 준다).
 *
 * 판 칸 번호
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */
import { Engine } from './engine.js';
import { SoloGame } from './solo.js';
import { t, tText, hasText } from './texts.js';

const W = 'white', K = 'black', R = 'red', B = 'blue';

export const TUTORIAL_SCENES = [
  {
    id: 'night', num: 0, kind: 'story', // 글: night.title · night.sub
    button: '시작하기' // 카드 글: night.card.1, .card.2 …
  },
  {
    id: 'people', num: 1, kind: 'dice', // 글: people.title · people.sub
    dice: [
      { color: W, value: 3, name: '마을 어른', group: '흰색 — 마을과 장터 사람들' },
      { color: K, value: 4, name: '인쇄공', group: '검정 — 도시의 일하는 사람들' },
      { color: R, value: 2, name: '여학생', group: '빨강 — 학생과 젊은이들' },
      { color: B, value: 5, name: '전도부인', group: '파랑 — 신앙의 사람들' },
      { color: K, value: 1, name: '밀정', group: '사람들 사이에 섞여 든 감시자', spy: true }
    ],
    summary: { dice: [[W, 3], [K, 4], [R, 2], [B, 5], [K, 1]] } // 글: people.summary
  },
  {
    id: 'place', num: 2, kind: 'play', // 글: place.title · place.sub
    nights: 1, seed: 1902,
    scriptedPools: [[[R, 2], [K, 3], [W, 4], [B, 5]]],
    steps: [
      { move: { die: null, cell: null } }, // place.1
      { move: { die: null, cell: null } }, // place.2
      { next: true }, // place.3
      { next: true }  // place.4
    ],
    summary: {} // 글: place.summary
  },
  {
    id: 'hand', num: 3, kind: 'play', // 글: hand.title · hand.sub
    nights: 1, seed: 1903,
    startBoard: { 0: [W, 2], 1: [W, 5] },
    scriptedPools: [[[W, 6], [K, 3], [R, 4], [B, 2]]],
    steps: [
      { next: true }, // hand.1
      { move: { die: [W, 6], cell: 2 } }, // hand.2
      { next: true, act: 'keepPlaced' }, // hand.3
      { next: true }, // hand.4
      { reward: null }, // hand.5
      { move: { die: null, cell: null } }  // hand.6
    ],
    summary: { dice: [[W, 2], [W, 5], [W, 6]] } // 글: hand.summary
  },
  {
    id: 'link', num: 4, kind: 'play', // 글: link.title · link.sub
    nights: 1, seed: 1904,
    startBoard: { 3: [B, 5], 5: [B, 3] },
    scriptedPools: [[[B, 4], [B, 6], [W, 4], [K, 2]]],
    steps: [
      { move: { die: [B, 4], cell: 4, quiz: true } }, // link.1
      { next: true, act: 'keepPlaced' }, // link.2
      { reward: null }, // link.3
      { move: { die: null, cell: null } }  // link.4
    ],
    summary: { dice: [[B, 3], [B, 4], [B, 5]] } // 글: link.summary
  },
  {
    id: 'one', num: 5, kind: 'play', // 글: one.title · one.sub
    nights: 1, seed: 1905,
    startBoard: { 1: [R, 4], 4: [K, 4] },
    scriptedPools: [[[W, 4], [R, 4], [B, 6], [K, 2]]],
    steps: [
      { next: true }, // one.1
      { move: { die: [W, 4], cell: 7, quiz: true } }, // one.2
      { next: true, act: 'keepPlaced' }, // one.3
      { reward: null }, // one.4
      { move: { die: null, cell: null } }  // one.5
    ],
    summary: { dice: [[R, 4], [K, 4], [W, 4]] } // 글: one.summary
  },
  {
    id: 'keep', num: 6, kind: 'play', // 글: keep.title · keep.sub
    nights: 1, seed: 1906,
    startBoard: { 0: [R, 3], 2: [R, 5], 4: [K, 4] },
    scriptedPools: [[[R, 4], [W, 4], [B, 2], [K, 6]]],
    steps: [
      { move: { die: [R, 4], cell: 1 } }, // keep.1
      { keep: 1, quiz: true }, // keep.2
      { reward: null }, // keep.3
      { move: { die: [W, 4], cell: 7, quiz: true } }, // keep.4
      { keep: null }, // keep.5
      { reward: null }  // keep.6
    ],
    summary: {} // 글: keep.summary
  },
  {
    id: 'scatter', num: 7, kind: 'play', // 글: scatter.title · scatter.sub
    nights: 1, seed: 1907,
    startBoard: { 6: [W, 2], 7: [K, 5] },
    scriptedPools: [[[R, 6], [B, 3], [W, 4], [K, 2]]],
    steps: [
      { next: true }, // scatter.1
      { move: { die: [R, 6], cell: 8 } }, // scatter.2
      { next: true }, // scatter.3
      { move: { die: null, cell: null } }, // scatter.4
      { next: true }  // scatter.5
    ],
    summary: { extra: { boards: [{ 0: [W, 2], 1: [K, 5], 2: [B, 4], 5: [B, 5], 8: [B, 6] }, {}, { 0: [W, 2], 1: [K, 5], 8: [B, 6] }] } } // 글: scatter.summary · scatter.extra.title · .extra.1 …
  },
  {
    id: 'spy', num: 8, kind: 'play', // 글: spy.title · spy.sub
    nights: 2, seed: 1908,
    startBoard: { 0: [B, 2], 2: [B, 3] },
    scriptedPools: [
      [[B, 1], [W, 1], [R, 3], [K, 6]],
      [[W, 3], [B, 3], [W, 1], [K, 6]]
    ],
    steps: [
      { move: { die: [B, 1], cell: 1 } }, // spy.1
      { next: true }, // spy.2
      { move: { die: [R, 3], cell: 4 } }, // spy.3
      { next: true }, // spy.4
      { move: { die: [W, 3], cell: 3 } }, // spy.5
      { move: { die: [B, 3], cell: 5 } }, // spy.6
      { keep: null }, // spy.7
      { next: true }, // spy.8
      { reward: null }  // spy.9
    ],
    summary: {} // 글: spy.summary
  },
  {
    id: 'withdraw', num: 9, kind: 'play', // 글: withdraw.title · withdraw.sub
    nights: 1, seed: 1909,
    startBoard: { 3: [K, 1], 5: [W, 1] },
    scriptedPools: [[[R, 1], [B, 1], [W, 1], [K, 1]]],
    steps: [
      { move: { die: null, cell: 4 } }, // withdraw.1
      { next: true }, // withdraw.2
      { move: { die: null, cell: null } }  // withdraw.3
    ],
    summary: {} // 글: withdraw.summary
  },
  {
    id: 'cross', num: 10, kind: 'play', // 글: cross.title · cross.sub
    nights: 1, seed: 1910,
    startBoard: { 0: [B, 4], 1: [B, 5], 5: [K, 6], 6: [W, 1], 8: [R, 6] },
    scriptedPools: [[[B, 6], [W, 6], [K, 3], [R, 5]]],
    steps: [
      { next: true }, // cross.1
      { move: { die: [B, 6], cell: 2, quiz: true } }, // cross.2
      { next: true }, // cross.3
      { order: true }, // cross.4
      { reward: null }, // cross.5
      { move: { die: null, cell: null } }  // cross.6
    ],
    summary: {} // 글: cross.summary
  },
  {
    id: 'flag', num: 11, kind: 'play', // 글: flag.title · flag.sub
    nights: 1, seed: 1911,
    startBoard: { 6: [K, 2], 7: [K, 4] },
    startRecord: { taegeuk: 1, geon: 1, ri: 1, gam: 1 },
    scriptedPools: [[[K, 6], [K, 3], [W, 5], [R, 2]]],
    steps: [
      { next: true }, // flag.1
      { move: { die: [K, 6], cell: 8 } }, // flag.2
      { next: true, act: 'keepPlaced' }, // flag.3
      { reward: 'gon', quiz: true }, // flag.4
      { next: true }, // flag.5
      { move: { die: null, cell: null } }  // flag.6
    ],
    summary: {} // 글: flag.summary
  },
  {
    id: 'free', num: 12, kind: 'play', // 글: free.title · free.sub
    nights: 3, seed: 386, poolSize: 4,
    goal: { combos: 2, score: 5 },
    steps: [
      { next: true }  // free.1
    ]
  },
  {
    id: 'end', num: null, kind: 'story', // 글: end.title · end.sub
    button: '첫 걸음 마치기' // 카드 글: end.card.1, .card.2 …
  }
];

/** 장면 이름 · 한 줄 설명(texts/tutorial.md) */
export function sceneTitle(scene) { return tText(scene.id + '.title'); }
export function sceneSub(scene) { return tText(scene.id + '.sub'); }
/** 이야기 장면의 카드 수: 장면.card.1, .card.2 … 가 이어지는 만큼 */
export function sceneCardCount(scene) {
  let n = 0;
  while (hasText(scene.id + '.card.' + (n + 1))) n++;
  return n;
}

function dieKey(d) { return d.color + d.value; } // 힌트 아이디 끝(예: blue6)
function sameDie(d, spec) { return !!d && d.color === spec[0] && d.value === spec[1]; }

/**
 * TutorialGame — play 장면 하나. SoloGame을 그대로 쓰고, 행동마다 지금 단계에 맞는지 먼저 본다.
 * 맞지 않으면 엔진에 넘기지 않고 hint(말풍선 아래 힌트) · shake(흔들 대상)만 남긴다.
 */
export class TutorialGame extends SoloGame {
  constructor(scene) {
    super(scene, 'tutorial', {});
    this.scene = scene;
    this.stepIndex = 0;
    this.wrong = 0;    // 지금 단계에서 틀린 횟수(두 번이면 정답 강조)
    this.hint = null;  // 지금 보여 줄 힌트
    this.shake = null; // { kind: 'die' | 'cell' | 'reward', id }
  }

  _buildAndStart() {
    const scene = this.level;
    const g = Engine.create({
      n: 1, types: ['human'], seed: scene.seed, ruleMode: 'basic',
      maxRounds: scene.nights || 1, poolSize: scene.poolSize || 4,
      eyeChance: null, scriptedPools: scene.scriptedPools || null
    });
    const p = g.players[0];
    const board = scene.startBoard || {};
    Object.keys(board).forEach(function (cell) {
      const spec = board[cell];
      p.board[Number(cell)] = { color: spec[0], value: spec[1] };
      g.bag[spec[0]]--;
    });
    if (scene.startRecord) Object.assign(p.parts, scene.startRecord);
    p.score = Engine.scoreOf(p);
    Engine.startRound(g);
    this.g = g;
    this.selectedPi = null;
  }

  get step() { return (this.scene.steps || [])[this.stepIndex] || null; }
  /** 지금 단계의 글 아이디 앞부분(장면.N) */
  get stepKey() { return this.scene.id + '.' + (this.stepIndex + 1); }

  // 힌트: 단계의 글이 있으면 그것, 없으면 공통 힌트. more는 더 구체적인 아이디 끝(예: 'blue6')
  _hint(kind, more) {
    const k = this.stepKey + '.hint.' + kind;
    if (more && hasText(k + '.' + more)) return t(k + '.' + more);
    if (hasText(k)) return t(k);
    return t('common.hint.' + kind);
  }
  /** 단계를 모두 지났고 판도 끝났으면 장면 끝 */
  get finished() { return this.g.done && !this.step; }
  get sceneCombos() { const s = this.player.stats; return s.same + s.consec + s.color; }
  /** 첫 밤길(장면 12)의 목표 */
  get goalMet() {
    const goal = this.scene.goal;
    return !!goal && (this.sceneCombos >= goal.combos || this.score >= goal.score);
  }

  _reveal(step) {
    const quiz = step.quiz || (step.move && step.move.quiz);
    return !quiz || this.wrong >= 2;
  }
  _advance() { this.stepIndex++; this.wrong = 0; this.hint = null; }
  _reject(hint, shake) { this.wrong++; this.hint = hint; this.shake = shake || null; return false; }

  /** 말풍선: 장면 이름 · 지금 할 말 · 힌트 · [다음] 여부 */
  coach() {
    const step = this.step;
    let text = '';
    if (step) {
      const k = this.stepKey;
      text = (step.move && this.selectedPi != null && hasText(k + '.place')) ? t(k + '.place') : t(k + '.say');
    }
    return { text: text, hint: this.hint, canNext: !!(step && step.next) };
  }

  /** 화면에서 강조할 것. locked면 강조된 주사위 말고는 흐리게 */
  targets() {
    const t = { dice: [], cells: [], keep: [], rewards: [], locked: false };
    const step = this.step;
    if (!step) return t;
    const reveal = this._reveal(step);
    if (step.move) {
      if (this.selectedPi == null) {
        if (step.move.die && reveal) {
          const spec = step.move.die;
          this.pool.forEach(function (d, i) { if (sameDie(d, spec)) t.dice.push(i); });
          t.locked = true;
        }
      } else if (step.move.cell != null && reveal) {
        t.cells.push(step.move.cell);
      }
    }
    if (step.keep != null && reveal) t.keep.push(step.keep);
    if (step.reward && reveal) t.rewards.push(step.reward);
    return t;
  }

  /** 모둠 순서 · 조각 고르기 창을 지금 띄워도 되는지(설명하는 동안은 숨김) */
  overlayAllowed() {
    const step = this.step;
    if (!step) return true;
    if (this.g.phase === 'combo_reward') return step.reward !== undefined;
    if (this.g.phase === 'combo_order') return !!step.order;
    return false;
  }

  next() {
    const step = this.step;
    if (!step || !step.next) return false;
    if (step.act === 'keepPlaced' && this.g.phase === 'combo_keep') {
      super.chooseKeep(this.g.pending.placedCell);
    }
    this._advance();
    return true;
  }

  selectDie(pi) {
    const step = this.step;
    if (step && !step.move) return this._reject(step.next ? t('common.waitNext') : null);
    if (step && step.move.die && this.selectedPi !== pi) {
      const d = this.pool[pi];
      if (!sameDie(d, step.move.die)) return this._reject(this._hint('die', dieKey(d)), { kind: 'die', id: pi });
    }
    this.hint = null;
    return super.selectDie(pi);
  }

  placeAt(cell) {
    const step = this.step;
    if (this.g.phase !== 'place' || this.selectedPi == null) return false;
    if (step) {
      if (this.validCells().indexOf(cell) < 0) return this._reject(this._hint('invalid'), { kind: 'cell', id: cell });
      if (step.move.cell != null && cell !== step.move.cell) return this._reject(this._hint('cell'), { kind: 'cell', id: cell });
    }
    const ok = super.placeAt(cell);
    if (ok && step) this._advance();
    return ok;
  }

  chooseKeep(cell) {
    const step = this.step;
    if (step) {
      if (step.keep === undefined) return this._reject(step.next ? t('common.waitNext') : null);
      if (step.keep != null && cell !== step.keep) return this._reject(this._hint('keep'), { kind: 'cell', id: cell });
    }
    const ok = super.chooseKeep(cell);
    if (ok && step) this._advance();
    return ok;
  }

  chooseReward(key) {
    const step = this.step;
    if (step) {
      if (step.reward === undefined) return this._reject(step.next ? t('common.waitNext') : null);
      if (step.reward && key !== step.reward) return this._reject(this._hint('reward'), { kind: 'reward', id: key });
    }
    const ok = super.chooseReward(key);
    if (ok) this.hint = null;
    if (ok && step && this.g.phase !== 'combo_reward') this._advance();
    return ok;
  }

  chooseComboOrder(idx) {
    const step = this.step;
    if (step && !step.order) return this._reject(step.next ? t('common.waitNext') : null);
    const ok = super.chooseComboOrder(idx);
    if (ok && step) this._advance();
    return ok;
  }

  /** 지금 장면이 첫 밤길처럼 안내 없이 두는 중인지 */
  get freePlay() { return !this.step && !this.g.done; }
}
