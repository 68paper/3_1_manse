/*
 * js/link/netgame.js — 연결된 두 기기가 한 판을 함께 두기(시험판)
 * ------------------------------------------------------------------
 * 판정은 자유 연습과 같은 MultiGame(→ engine.js)을 쓴다. 엔진은 시드가 같으면
 * 같은 주사위를 뽑으므로, 판 전체가 아니라 "행동"만 주고받으면 두 기기의 판이 같아진다.
 *
 *   방장(자리 0)이 판정의 기준이다.
 *   - 시작: 방장이 시드를 정해 { type: 'start', seed, names }를 보낸다.
 *   - 방장 차례: 방장이 행동을 적용하고 { type: 'act', seq, a, hash }를 보낸다.
 *   - 참가자 차례: 참가자는 { type: 'intent', a }만 보내고, 방장이 차례 · 규칙을 확인해
 *     적용한 뒤 'act'로 돌려준다. 참가자는 'act'를 받았을 때만 판에 적용한다.
 *   - hash: 적용한 뒤의 판 요약. 참가자가 자기 판과 비교해 어긋나면 알린다(desync).
 *
 * 행동 a = [종류, 값...]
 *   ['place', pi, cell] · ['keep', cell] · ['eye', cell] · ['reward', key] · ['order', idx]
 *   ['blockedPool', pi] · ['blockedEye', cell]
 */
import { Engine } from '../engine.js';
import { MultiGame } from '../multi.js';

// 엔진이 같은 시드로 같은 판을 만들어야 하므로, 엔진 동작이 바뀌면 올린다(2: 첫 순서 공정 섞기)
export const PROTOCOL = 2;

export class NetGame {
  /**
   * @param link   PeerLink(연결된 상대)
   * @param isHost 방장이면 true(자리 0), 참가자면 false(자리 1)
   */
  constructor(link, isHost) {
    this.link = link;
    this.isHost = isHost;
    this.mySeat = isHost ? 0 : 1;
    this.game = null;
    this.seq = 0;
    this.desync = false;
    this.lastCell = null; // 방금 놓인 칸 — 화면에서 한 번 튕기기
    this.lastSeat = null; // 그 칸을 놓은 자리
    this.onChange = function () {};
    this.onError = function () {};
    const self = this;
    link.on('message', function (msg) { self._onMessage(msg); });
  }

  /** 방장: 새 판을 시작하고 참가자에게 알린다 */
  start(seed, names) {
    if (!this.isHost) return;
    this._create(seed, names);
    this.link.send({ type: 'start', v: PROTOCOL, seed: seed, names: names });
    this.onChange();
  }

  _create(seed, names) {
    this.game = new MultiGame({ seed: seed, nights: 8 }, [
      { type: 'human', name: names[0] },
      { type: 'human', name: names[1] }
    ]);
    this.seq = 0;
    this.desync = false;
    this.lastCell = null;
    this.lastSeat = null;
  }

  get g() { return this.game && this.game.g; }
  get currentSeat() { const g = this.g; return g && !g.done ? Engine.current(g).id : null; }
  get isMyTurn() { return this.currentSeat === this.mySeat; }

  /** 판 요약: 두 판 · 점수 · 조각 · 광장 · 단계 · 밤 */
  hash() {
    const g = this.g;
    return [g.round, g.phase, g.orderAt, g.placementsThisTurn,
      g.pool.map(function (d) { return d.color[0] + d.value; }).join(''),
      g.players.map(function (p) { return Engine.snapshotBoard(p) + '|' + p.score + '|' + Engine.pieceTotal(p) + '|' + (p.pushed || 0); }).join('/')
    ].join(';');
  }

  /** 내 행동. 내 차례가 아니면 무시 */
  act(a) {
    if (!this.game || this.g.done || !this.isMyTurn) return false;
    if (this.isHost) return this._applyAndBroadcast(a);
    this.link.send({ type: 'intent', a: a });
    return true;
  }

  _apply(a) {
    const game = this.game;
    const kind = a[0];
    let ok = false;
    if (kind === 'place') {
      if (game.phase !== 'place' || !game.pool[a[1]]) return false;
      const seat = this.currentSeat;
      game.selectedPi = a[1];
      ok = game.placeAt(a[2]);
      if (ok) { this.lastCell = a[2]; this.lastSeat = seat; }
    }
    else if (kind === 'keep') ok = game.chooseKeep(a[1]);
    else if (kind === 'eye') ok = game.chooseEye(a[1]);
    else if (kind === 'reward') ok = game.chooseReward(a[1]);
    else if (kind === 'order') ok = game.chooseComboOrder(a[1]);
    else if (kind === 'blockedPool') { if (game.phase !== 'blocked_pool') return false; game.resolveBlockedPool(a[1]); ok = true; }
    else if (kind === 'blockedEye') ok = game.removeBlockedEye(a[1]);
    return ok !== false;
  }

  _applyAndBroadcast(a) {
    if (!this._apply(a)) return false;
    this.seq++;
    this.link.send({ type: 'act', seq: this.seq, a: a, hash: this.hash() });
    this.onChange();
    return true;
  }

  _onMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'start' && !this.isHost) {
      if (msg.v !== PROTOCOL) { this.onError('두 기기의 앱 버전이 달라요. 둘 다 새로 고침해 주세요.'); return; }
      this._create(msg.seed, msg.names);
      this.onChange();
    } else if (msg.type === 'intent' && this.isHost) {
      // 참가자의 행동: 참가자 차례이고 규칙에 맞을 때만 적용
      if (!this.game || this.g.done || this.currentSeat !== 1 || !Array.isArray(msg.a)) return;
      this._applyAndBroadcast(msg.a);
    } else if (msg.type === 'act' && !this.isHost) {
      if (!this.game) return;
      if (msg.seq !== this.seq + 1) { this.desync = true; this.onError('행동 순서가 어긋났어요(' + this.seq + ' → ' + msg.seq + ').'); return; }
      this.seq = msg.seq;
      if (!this._apply(msg.a) || this.hash() !== msg.hash) {
        this.desync = true;
        this.onError('두 기기의 판이 달라졌어요. 이 판은 다시 시작해 주세요.');
      }
      this.onChange();
    }
  }
}
