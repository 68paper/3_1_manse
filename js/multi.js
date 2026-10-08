/*
 * js/multi.js — 자유 연습: 3~5명(사람 · AI)이 함께하는 여덟 밤
 * ------------------------------------------------------------------
 * 엔진(engine.js)은 원래 여러 명을 지원한다: 플레이어마다 자기 판, 광장(인원×2+2개),
 * 밤마다 점수가 낮은 사람부터 차례로 두 개씩 놓기, AI 행동(Engine.aiAct).
 * 여기서는 SoloGame의 화면용 인터페이스를 그대로 쓰되, '지금 화면에 보이는 플레이어'를
 * 차례가 된 사람으로 바꾸고, AI 차례를 한 걸음씩 진행하는 aiStep()을 더한다.
 * 사람끼리는 한 기기를 돌려 가며 둔다(핫시트).
 */
import { Engine } from './engine.js';
import { SoloGame } from './solo.js';

export class MultiGame extends SoloGame {
  /**
   * @param level  makePracticeLevel()의 결과(시드 · 밤 수)
   * @param seats  [{ type: 'human'|'ai', name }] 3~5개
   */
  constructor(level, seats) {
    super(level, 'practice', { seats: seats });
  }

  _buildAndStart() {
    const seats = this.opts.seats;
    const g = Engine.create({
      n: seats.length,
      types: seats.map(function (s) { return s.type; }),
      seed: this.level.seed,
      ruleMode: 'basic',
      maxRounds: this.level.nights || 8,
      poolSize: null,      // 원본 규칙: 인원×2+2
      eyeChance: null,
      scriptedPools: null
    });
    g.players.forEach(function (p, i) { p.name = seats[i].name; });
    Engine.startRound(g);
    this.g = g;
    this.selectedPi = null;
    this.lastAiCell = null;
  }

  /** 지금 차례인 플레이어. 끝난 뒤에는 첫 번째 사람 플레이어 */
  get player() {
    const g = this.g;
    if (!g.done && g.order.length && g.orderAt < g.order.length) return Engine.current(g);
    return g.players.find(function (p) { return p.type === 'human'; }) || g.players[0];
  }
  get isAiTurn() { return !this.g.done && this.player.type === 'ai'; }

  /** AI 차례에 한 걸음(놓기 한 번, 남기기 한 번, 조각 하나 …)만 진행. 놓은 칸은 lastAiCell에 남긴다 */
  aiStep() {
    if (!this.isAiTurn) return false;
    const before = this.g.events.length;
    const ok = Engine.aiAct(this.g);
    this.lastAiCell = null;
    for (let i = this.g.events.length - 1; i >= before; i--) {
      const e = this.g.events[i];
      if (e.type === 'placement') { this.lastAiCell = e.data.cell; break; }
    }
    return ok;
  }

  /** 순위: 점수 높은 순, 같으면 나중에 그 점수에 올라선 사람이 앞(룰북 v1.1: 같은 칸이면 위에 있는 말이 앞선다) */
  standings() {
    return this.g.players.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.arrival - a.arrival;
    }).map(function (p) {
      return { id: p.id, name: p.name, type: p.type, score: Engine.scoreOf(p), flags: Engine.flagsOf(p), pieces: Engine.pieceTotal(p), pushed: p.pushed || 0, arrival: p.arrival, board: p.board.slice() };
    });
  }

  snapshot() {
    const base = super.snapshot();
    const cur = this.player;
    base.players = this.g.players.map(function (p) {
      return { id: p.id, name: p.name, type: p.type, score: Engine.scoreOf(p), arrival: p.arrival, current: p === cur, board: p.board.slice() };
    });
    // 이번 밤 고르는 순서(룰북 §4-2: 점수가 낮은 사람부터, 같은 칸이면 아래에 깔린 말 = 먼저 도착한 말부터)
    base.order = this.g.order.slice();
    base.orderAt = this.g.orderAt;
    base.playerName = cur.name;
    base.isAiTurn = this.isAiTurn;
    base.lastAiCell = this.lastAiCell;
    if (!base.done) {
      base.message = this.isAiTurn ? cur.name + ' 차례 · 생각하는 중…' : cur.name + ' 차례 · ' + base.message;
    }
    return base;
  }

  endMessage() { return '여덟 번째 등잔이 꺼졌습니다.'; }
  starsEarned() { return 0; }
}
