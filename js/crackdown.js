/*
 * js/crackdown.js — 1인 모드 「단속의 밤」
 * ------------------------------------------------------------------
 * 여덟 밤. 밤마다 손 네 번(주사위 4개를 꺼내 2개를 놓고 2개는 돌려보냄), 밤이 끝나면
 * 그 밤에 공개된 단속 카드대로 낮 단속(빈 표시 칸에 밀정이 들어옴)이 온다.
 * 점수 대신 "숨겨 둔 태극기 장 수"를 센다: 모둠마다 자동으로 더하고, 밀정이 판에 들어오면 압수.
 *
 * engine.js는 고치지 않고 감싸서 쓴다.
 *   - 손 한 번 = 엔진의 라운드 한 번(poolSize 4, 두 번 놓기, 나머지 반환 — 엔진 규칙 그대로).
 *   - 밤 경계: g.settings.maxRounds를 "이번 밤까지의 손 수"로 맞춰 두면 넷째 손 뒤 엔진이
 *     endGame()으로 멈춘다. 낮을 처리한 뒤 done을 풀고 maxRounds를 늘려 startRound()로 이어 간다.
 *   - 조각 고르기(combo_reward)는 화면에 묻지 않고 바로 첫 옵션을 골라 넘긴다(조각은 쓰지 않음).
 *     장 수는 stats.same · consec · color가 늘어난 만큼 FLAGS_PER_COMBO로 더한다(교차 완성은 둘 다).
 *   - 낮 밀정의 줄 판정은 엔진의 finalizePlacement()와 같은 절차(흩어짐 → 감시 철수)를
 *     엔진이 내보내는 linesAt · isFull · comboType으로 옮겨 썼다(resolveLinesAt).
 *     finalizePlacement()는 내보내지 않는 함수이고, 부르면 다음 배치로 진행까지 해 버리기 때문.
 *   - 주머니에는 색만 있고 눈은 꺼낼 때 굴린다(엔진). 그래서 낮 밀정은 "주머니에서 색 하나를
 *     꺼내 눈 1로 놓기"이고, 건너뛰는 경우는 주머니가 완전히 비었을 때뿐이다.
 *
 * DOM을 쓰지 않으므로 Node(tools/simulate-crackdown.mjs)에서도 그대로 불러 쓴다.
 */
import { Engine } from './engine.js';
import { SoloGame } from './solo.js';
import { randomSeed } from './levelSetup.js';

/** 숫자 값은 모두 여기서. 시뮬레이션 뒤 조정한다 */
export const CRACKDOWN_CONFIG = {
  NIGHTS: 8,             // 밤 수. 마지막 밤 뒤에는 낮 단속이 없다(3월 1일)
  HANDS_PER_NIGHT: 4,    // 한 밤의 손 수
  HAND_SIZE: 4,          // 손마다 꺼내는 주사위 수(놓는 수 2는 엔진 규칙)
  START_FLAGS: 3,        // 시작 때 숨겨 둔 태극기
  FLAGS_PER_COMBO: { same: 2, consec: 2, color: 1 }, // 한뜻 · 연락망 · 한동네
  DAY_SPY_SEIZES: 1,     // 낮 밀정 하나가 들어올 때 압수되는 장 수
  SELF_SPY_SEIZES: true, // 손에서 밀정을 놓아도 압수하는지
  SELF_SPY_AMOUNT: 1,
  EARLY_CARDS: 3,        // 초반 낮 수: 초반 이야기 + 밀정 1칸 모양
  LATE_CARDS: 3,         // 후반 낮 수: 후반 이야기 + 밀정 2칸 모양
  FINAL_CARDS: 1,        // 마지막 낮 수: 후반 이야기 + 밀정 3칸 모양(마지막에 한 번만)
  STARS: [1, 6, 10]      // 성공 시 손에 든 장 수 기준: 별 1 · 2 · 3
};

export const NIGHT_ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];
export function nightOrdinal(n) { return NIGHT_ORDINAL[n - 1] || (n + '번째'); }

/**
 * 카드 데이터(data/crackdown.json) → 이번 판의 단속 순서.
 *   이야기: 초반 더미에서 EARLY_CARDS장, 후반 더미에서 LATE_CARDS + FINAL_CARDS장을 무작위로 뽑아
 *           각각 order(사건이 일어난 순서)대로 늘어놓는다 → 밤이 지날수록 3월 1일에 가까운 이야기.
 *   밀정 칸: 이야기와 따로 섞는다. 초반 낮은 1칸 모양, 후반 낮은 2칸 모양에서 겹치지 않게 뽑고,
 *           3칸 모양은 마지막 FINAL_CARDS번의 낮에만 쓴다.
 * 칸 번호는 화면 설명용 1~9 → 코드용 0~8로 바꾼다. 난수는 판 시드에서 따로 만든 mulberry32 흐름
 * (주사위를 꺼내는 g.rng와 섞이지 않도록).
 */
export function buildCrackdownDeck(data, seed, cfg) {
  const rng = Engine.mulberry32((seed ^ 0x9E3779B9) >>> 0);
  const shuffled = function (list) {
    list = list.slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  };
  const stories = function (pile, count) {
    return shuffled(data.stories.filter(function (s) { return s.pile === pile; }))
      .slice(0, count).sort(function (a, b) { return a.order - b.order; });
  };
  // 모양이 모자라면 한 바퀴 더 섞어 이어 붙인다(설정을 크게 바꿨을 때만)
  const patterns = function (kind, count) {
    const pool = data.patterns[kind] || [];
    let out = [];
    while (pool.length && out.length < count) out = out.concat(shuffled(pool));
    return out.slice(0, count);
  };
  const early = stories('early', cfg.EARLY_CARDS);
  const late = stories('late', cfg.LATE_CARDS + cfg.FINAL_CARDS);
  const cells = patterns('early', early.length)
    .concat(patterns('late', Math.min(cfg.LATE_CARDS, late.length)))
    .concat(patterns('final', Math.max(0, late.length - cfg.LATE_CARDS)));
  return early.concat(late).map(function (s, i) {
    return {
      id: s.id, name: s.name, background: s.background, period: s.period, pile: s.pile,
      cells: (cells[i] || []).map(function (n) { return n - 1; }).sort(function (a, b) { return a - b; })
    };
  });
}

/**
 * 판에 막 들어온 주사위(cell) 기준으로 가로 · 세로 줄을 정리한다.
 * engine.js finalizePlacement()의 흩어짐 → 감시 철수 부분과 같은 절차.
 */
export function resolveLinesAt(g, p, cell) {
  const out = { scattered: [], withdrawn: [] };
  Engine.linesAt(cell).forEach(function (line) {
    if (Engine.isFull(p.board, line) && !Engine.comboType(p.board, line)) {
      const removed = line.filter(function (i) { return p.board[i] && p.board[i].value !== 1; });
      if (removed.length > 0) {
        removed.forEach(function (i) { g.bag[p.board[i].color]++; p.board[i] = null; });
        p.stats.scatterLines++; p.stats.scatterDice += removed.length;
        out.scattered = out.scattered.concat(removed);
      }
    }
  });
  Engine.linesAt(cell).forEach(function (line) {
    if (Engine.isFull(p.board, line) && line.every(function (i) { return p.board[i].value === 1; })) {
      line.forEach(function (i) { g.bag[p.board[i].color]++; p.board[i] = null; });
      p.stats.withdrawn++;
      out.withdrawn = out.withdrawn.concat(line);
    }
  });
  return out;
}

export function makeCrackdownLevel(seed) {
  return {
    id: 'crackdown', region: '단속의 밤', title: '단속의 밤',
    nights: CRACKDOWN_CONFIG.NIGHTS, poolSize: CRACKDOWN_CONFIG.HAND_SIZE,
    seed: seed != null ? seed : randomSeed(),
    eyeChance: null, startEyes: [], scriptedPools: null,
    goal: { type: 'flags' }, stars: CRACKDOWN_CONFIG.STARS
  };
}

const WATCHED = ['same', 'consec', 'color', 'eyesTaken'];

/**
 * CrackdownGame — SoloGame의 화면용 인터페이스를 그대로 쓰고, 밤 · 낮 · 장 수만 더한다.
 * @param level   makeCrackdownLevel()의 결과
 * @param cards   data/crackdown.json 객체({ stories, patterns })
 * @param config  CRACKDOWN_CONFIG 중 바꿀 값(시뮬레이션용)
 */
export class CrackdownGame extends SoloGame {
  constructor(level, cards, config) {
    super(level, 'crackdown', { cards: cards, config: config });
  }

  _buildAndStart() {
    const cfg = this.cfg = Object.assign({}, CRACKDOWN_CONFIG, this.opts.config || {});
    const g = Engine.create({
      n: 1, types: ['human'], seed: this.level.seed, ruleMode: 'basic',
      maxRounds: cfg.HANDS_PER_NIGHT, poolSize: cfg.HAND_SIZE,
      eyeChance: null, scriptedPools: null
    });
    this.g = g;
    this.selectedPi = null;
    this.deck = buildCrackdownDeck(this.opts.cards || { stories: [], patterns: {} }, this.level.seed, cfg);
    this.nightNo = 1;
    this.hidden = cfg.START_FLAGS; // 지금 숨겨 둔 장 수
    this.seized = 0;               // 지금까지 빼앗긴 장 수
    this.made = 0;                 // 지금까지 만든 장 수
    this.failed = false;
    this.failedAt = null;          // { night, when: 'night' | 'day' }
    this.finished = false;
    this.dayState = null;          // 낮 단속 중: { card, queue: [칸], results: [] }
    this.events = [];              // 화면 연출용: { type: 'gain' | 'seize', ... } — takeEvents()로 가져감
    this.daySpies = 0; this.guarded = 0;
    this._seen = {};
    const st = this.player.stats;
    WATCHED.forEach((k) => { this._seen[k] = st[k]; });
    Engine.startRound(g);
    this._settle();
  }

  // ---- 조회 ----
  get night() { return this.nightNo; }
  get maxNights() { return this.cfg.NIGHTS; }
  get done() { return this.failed || this.finished; }
  get phase() {
    if (this.done) return 'end';
    if (this.dayState) return 'day';
    return this.g.phase;
  }
  /** 이번 밤의 몇째 손인지(1부터) */
  get hand() { return this.g.round - (this.nightNo - 1) * this.cfg.HANDS_PER_NIGHT; }
  /** 이번 손에서 몇째로 놓는지(1부터) */
  get pick() { return this.g.placementsThisTurn + 1; }
  /** 이번 밤이 끝나면 올 단속 카드. 마지막 밤(또는 카드가 모자라면) null */
  get card() {
    if (this.nightNo >= this.cfg.NIGHTS) return null;
    return this.deck[this.nightNo - 1] || null;
  }
  get completed() { return this.finished; }

  snapshot() {
    const base = super.snapshot();
    base.phase = this.phase;
    base.done = this.done;
    base.message = this._messageFor(base.phase);
    if (this.done) base.pool = [];
    base.crackdown = {
      hidden: this.hidden, seized: this.seized, made: this.made,
      card: this.dayState ? this.dayState.card : this.card,
      hand: this.hand, handsPerNight: this.cfg.HANDS_PER_NIGHT, pick: this.pick,
      day: this.dayState, failed: this.failed, failedAt: this.failedAt, finished: this.finished
    };
    return base;
  }

  _messageFor(phase) {
    switch (phase) {
      case 'place': return this.pick === 1 ? '이번 손에서 놓을 사람을 골라 주세요.' : '한 사람 더 골라 놓아 주세요. 남은 사람은 돌아가요.';
      case 'combo_eye': return '쫓아낼 밀정을 골라 주세요.';
      case 'day': return '날이 밝았어요. 「' + this.dayState.card.name + '」 단속이 시작돼요.';
      default: return super._messageFor(phase);
    }
  }

  endMessage() {
    if (this.failed) {
      return nightOrdinal(this.failedAt.night) + ' 밤' + (this.failedAt.when === 'day' ? ' 낮' : '') + ', 숨겨 둔 태극기를 모두 빼앗겼어요.';
    }
    return '1919년 3월 1일, 날이 밝았습니다.';
  }

  /** 화면 연출용 사건을 가져가고 비운다 */
  takeEvents() { const e = this.events; this.events = []; return e; }

  // ---- 행동(엔진에 넘긴 뒤 장 수 · 밤 경계를 정리) ----
  selectDie(pi) { if (this.done || this.dayState) return false; return super.selectDie(pi); }
  placeAt(cell) { if (this.done || this.dayState) return false; const r = super.placeAt(cell); this._settle(); return r; }
  chooseComboOrder(idx) { if (this.done) return false; const r = super.chooseComboOrder(idx); this._settle(); return r; }
  chooseKeep(cell) { if (this.done) return false; const r = super.chooseKeep(cell); this._settle(); return r; }
  chooseEye(cell) { if (this.done) return false; const r = super.chooseEye(cell); this._settle(); return r; }
  resolveBlockedPool(pi) { if (this.done || this.dayState) return false; const r = super.resolveBlockedPool(pi); this._settle(); return r; }
  removeBlockedEye(cell) { if (this.done) return false; const r = super.removeBlockedEye(cell); this._settle(); return r; }
  chooseReward() { return false; } // 이 모드는 조각을 고르지 않는다
  quit() { return false; }

  _settle() {
    const g = this.g, cfg = this.cfg;
    // 조각 고르기는 묻지 않는다. 남은 보상을 첫 옵션으로 넘기면 엔진이 다음 모둠 · 흩어짐까지 진행한다
    while (g.phase === 'combo_reward') Engine.chooseReward(g, g.pending.rewardOptions[0]);

    const st = this.player.stats, seen = this._seen;
    ['same', 'consec', 'color'].forEach((type) => {
      const n = st[type] - seen[type];
      if (n > 0) {
        const gain = n * cfg.FLAGS_PER_COMBO[type];
        this.hidden += gain; this.made += gain;
        this.events.push({ type: 'gain', combo: type, flags: gain });
      }
    });
    const spies = st.eyesTaken - seen.eyesTaken;
    WATCHED.forEach((k) => { seen[k] = st[k]; });
    if (spies > 0 && cfg.SELF_SPY_SEIZES) this._seize(spies * cfg.SELF_SPY_AMOUNT, 'self', 'night');
    if (this.failed) return;

    // 넷째 손이 끝나 엔진이 멈췄으면 낮(또는 3월 1일)으로
    if (g.done && !this.dayState) {
      if (this.nightNo >= cfg.NIGHTS) { this.finished = true; this.selectedPi = null; return; }
      const card = this.card;
      if (card) this.dayState = { card: card, queue: card.cells.slice(), results: [] };
      else this.endDay(); // 카드가 모자라면 낮 없이 다음 밤
    }
  }

  _seize(amount, reason, when) {
    const n = Math.min(amount, this.hidden);
    this.hidden -= n; this.seized += n;
    this.events.push({ type: 'seize', reason: reason, flags: n });
    if (this.hidden <= 0) {
      this.failed = true;
      this.failedAt = { night: this.nightNo, when: when };
      this.selectedPi = null;
    }
  }

  /** 낮 단속에 처리할 표시 칸이 남았는지 */
  get dayPending() { return !!(this.dayState && this.dayState.queue.length > 0 && !this.done); }

  /**
   * 표시 칸 하나를 처리한다(칸 번호 오름차순).
   * 결과: { cell, kind: 'spy' | 'guarded' | 'skip', color?, scattered?, withdrawn?, seized? }
   */
  dayStep() {
    if (!this.dayPending) return null;
    const g = this.g, p = this.player, ds = this.dayState;
    const cell = ds.queue.shift();
    let r;
    if (p.board[cell]) {
      r = { cell: cell, kind: 'guarded' };
      this.guarded++;
    } else if (Engine.bagTotal(g.bag) === 0) {
      r = { cell: cell, kind: 'skip' };
    } else {
      const color = Engine.drawFromBag(g.bag, 1, g.rng).colors[0];
      p.board[cell] = { color: color, value: 1 };
      const lines = resolveLinesAt(g, p, cell);
      r = { cell: cell, kind: 'spy', color: color, scattered: lines.scattered, withdrawn: lines.withdrawn };
      this.daySpies++;
      const before = this.hidden;
      this._seize(this.cfg.DAY_SPY_SEIZES, 'day', 'day');
      r.seized = before - this.hidden;
    }
    ds.results.push(r);
    return r;
  }

  /** 낮을 마치고 다음 밤의 첫 손을 꺼낸다 */
  endDay() {
    if (this.done) return false;
    const g = this.g;
    this.dayState = null;
    this.nightNo++;
    g.done = false; g.phase = 'idle';
    g.settings.maxRounds = this.nightNo * this.cfg.HANDS_PER_NIGHT;
    Engine.startRound(g);
    this._settle();
    return true;
  }

  /** 성공 시 손에 든 장 수로 별 0~3 */
  starsEarned() {
    if (!this.finished) return 0;
    return this.cfg.STARS.filter((t) => this.hidden >= t).length;
  }
}
