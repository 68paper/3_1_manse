/*
 * js/link/netgame.js — 연결된 기기들이 한 판을 함께 두기(시험판, 2 - 5명)
 * ------------------------------------------------------------------
 * 판정은 자유 연습과 같은 MultiGame(→ engine.js)을 쓴다. 엔진은 시드가 같으면
 * 같은 주사위를 뽑으므로, 판 전체가 아니라 "행동"만 주고받으면 모든 기기의 판이 같아진다.
 *
 * 연결은 별 모양이다. 방장 기기가 참가자마다 연결(PeerLink)을 하나씩 갖고,
 * 참가자끼리는 직접 잇지 않는다. 방장이 판정의 기준이고 모든 소식을 전해 준다.
 *
 *   - 모이기: 참가자가 연결되면 방장이 { type: 'lobby', v, count }로 지금 인원을 알린다.
 *   - 순서 정하기: 방장이 시작하면 자리를 정해(방장 0, 연결된 순서대로 1, 2 …) 참가자마다
 *     { type: 'roll-begin', v, names, seat }를 보낸다. 굴리기는 방장이 대신 굴려
 *     { type: 'roll', seat, die }를 모두에게 알린다(참가자는 { type: 'roll-intent' }만 보낸다).
 *     같은 눈이면 그 사람들만 다시 굴린다(js/firstRoll.js).
 *   - 시작: 순서가 정해지면 { type: 'start', v, seed, names, firstOrder }.
 *   - 방장 차례: 방장이 행동을 적용하고 { type: 'act', seq, a, hash }를 모두에게 보낸다.
 *   - 참가자 차례: 참가자는 { type: 'intent', a }만 보내고, 방장이 그 사람 차례인지 · 규칙에
 *     맞는지 확인해 적용한 뒤 'act'로 모두에게 돌려준다. 참가자는 'act'를 받았을 때만 적용한다.
 *   - hash: 적용한 뒤의 판 요약. 참가자가 자기 판과 비교해 어긋나면 알린다(desync).
 *   - 나감: 판 도중 참가자 연결이 끊기면 방장이 { type: 'left', seat }를 알린다.
 *     그 사람 차례가 오면 판이 멈추고, 방장이 남은 사람끼리 새 판을 시작할 수 있다.
 *
 * 행동 a = [종류, 값...]
 *   ['place', pi, cell] · ['keep', cell] · ['eye', cell] · ['reward', key] · ['order', idx]
 *   ['blockedPool', pi] · ['blockedEye', cell]
 */
import { Engine } from '../engine.js';
import { MultiGame } from '../multi.js';
import { FirstRoll, rollDie } from '../firstRoll.js';

// 엔진이 같은 시드로 같은 판을 만들어야 하므로, 엔진 동작이나 주고받는 말이 바뀌면 올린다
// (2: 첫 순서 공정 섞기, 3: 주사위 굴려 순서 정하기, 4: 2 - 5명 · 모이기 · 자리 번호)
export const PROTOCOL = 4;
export const MAX_PLAYERS = 5;

/** 자리 이름: 방장, 참가자 1, 참가자 2 … */
export function seatNames(n) {
  const names = ['방장'];
  for (let i = 1; i < n; i++) names.push('참가자 ' + i);
  return names;
}

export class NetGame {
  /** @param isHost 방장이면 true(자리 0). 참가자의 자리는 순서 정하기를 시작할 때 방장이 알려 준다 */
  constructor(isHost) {
    this.isHost = isHost;
    this.mySeat = isHost ? 0 : null;
    this.peers = [];        // 방장: [{ link, id, seat, gone }]
    this.hostLink = null;   // 참가자: 방장과의 연결
    this.hostGone = false;
    this.lobbyCount = 1;    // 참가자: 방장이 알려 준 지금 인원
    this.names = null;
    this.roll = null;       // 순서 정하기(FirstRoll). 판이 시작된 뒤에도 결과를 보여 주려고 남겨 둔다
    this.game = null;
    this.left = {};         // 판 도중 연결이 끊긴 자리
    this.seq = 0;
    this.desync = false;
    this.lastCell = null;   // 방금 놓인 칸 — 화면에서 한 번 튕기기
    this.lastSeat = null;   // 그 칸을 놓은 자리
    this._peerNo = 0;
    this.onChange = function () {};
    this.onError = function () {};
  }

  // ---- 연결 ----

  /** 방장: 연결된 참가자 하나를 더한다(모이는 동안) */
  addPeer(link) {
    const self = this;
    const peer = { link: link, id: ++this._peerNo, seat: null, gone: false };
    this.peers.push(peer);
    link.on('message', function (msg) { self._onPeerMessage(peer, msg); });
    link.on('close', function () { self._onPeerClose(peer); });
    this._sendLobby();
    this.onChange();
    return peer;
  }

  /** 참가자: 방장과의 연결을 붙인다 */
  attachHost(link) {
    const self = this;
    this.hostLink = link;
    link.on('message', function (msg) { self._onHostMessage(msg); });
    link.on('close', function () { self.hostGone = true; self.onChange(); });
  }

  /** 방장: 지금 연결되어 있는 참가자 */
  get connectedPeers() { return this.peers.filter(function (p) { return !p.gone; }); }
  /** 방장: 모인 인원(방장 포함) */
  get gatheredCount() { return 1 + this.connectedPeers.length; }

  _send(peer, obj) { if (!peer.gone) peer.link.send(obj); }
  // 판에 앉은 참가자 모두에게(모이는 동안 새로 온 사람은 다음 판부터)
  _broadcast(obj) { const self = this; this.peers.forEach(function (p) { if (p.seat != null) self._send(p, obj); }); }
  _sendLobby() {
    const count = this.gatheredCount;
    const self = this;
    this.peers.forEach(function (p) { self._send(p, { type: 'lobby', v: PROTOCOL, count: count }); });
  }

  _onPeerClose(peer) {
    if (peer.gone) return;
    peer.gone = true;
    if (peer.seat != null && (this.game || this.roll)) {
      this.left[peer.seat] = true;
      this._broadcast({ type: 'left', seat: peer.seat });
      if (this.rolling) this.onError(this.names[peer.seat] + '의 연결이 끊겨 순서를 정할 수 없어요. 남은 사람끼리 새 판을 시작해 주세요.');
      else if (this.game && !this.g.done) this.onError(this.names[peer.seat] + '의 연결이 끊겼어요. 그 사람 차례가 오면 판이 멈춰요. 남은 사람끼리 새 판을 시작할 수 있어요.');
    }
    this._sendLobby();
    this.onChange();
  }

  // ---- 순서 정하기 · 시작 ----

  /** 방장: 지금 모인 사람으로 새 판 — 자리를 정하고 주사위를 굴려 첫 밤 순서를 정한다 */
  start(seed) {
    if (!this.isHost) return false;
    const peers = this.connectedPeers.slice(0, MAX_PLAYERS - 1);
    if (peers.length < 1) return false;
    this.peers.forEach(function (p) { p.seat = null; });
    peers.forEach(function (p, i) { p.seat = i + 1; });
    this.names = seatNames(peers.length + 1);
    this.pendingSeed = seed;
    this.roll = new FirstRoll(this.names.length);
    this.game = null;
    this.left = {};
    this.desync = false;
    const self = this;
    peers.forEach(function (p) { self._send(p, { type: 'roll-begin', v: PROTOCOL, names: self.names, seat: p.seat }); });
    this.onChange();
    return true;
  }

  /** 순서 정하는 중인지 */
  get rolling() { return !!this.roll && !this.game; }
  /** 지금 내가 굴려야 하는지 */
  get myRollNeeded() { return this.rolling && this.mySeat != null && this.roll.needs(this.mySeat); }

  /** 내 주사위 굴리기 */
  rollMine() {
    if (!this.myRollNeeded) return false;
    if (this.isHost) return this._hostRoll(this.mySeat);
    this.hostLink.send({ type: 'roll-intent' });
    return true;
  }

  // 방장: 한 자리를 굴리고 결과를 알린다. 순서가 다 정해지면 판을 시작한다
  _hostRoll(seat) {
    if (!this.rolling || !this.roll.needs(seat)) return false;
    const die = rollDie();
    this.roll.roll(seat, die);
    this._broadcast({ type: 'roll', seat: seat, die: die });
    if (this.roll.done) {
      const order = this.roll.order();
      this._create(this.pendingSeed, this.names, order);
      this._broadcast({ type: 'start', v: PROTOCOL, seed: this.pendingSeed, names: this.names, firstOrder: order });
    }
    this.onChange();
    return true;
  }

  _create(seed, names, firstOrder) {
    this.names = names;
    this.game = new MultiGame({ seed: seed, nights: 8 }, names.map(function (n) { return { type: 'human', name: n }; }), firstOrder);
    this.seq = 0;
    this.desync = false;
    this.lastCell = null;
    this.lastSeat = null;
  }

  // ---- 판 ----

  get g() { return this.game && this.game.g; }
  get currentSeat() { const g = this.g; return g && !g.done ? Engine.current(g).id : null; }
  get isMyTurn() { return this.mySeat != null && this.currentSeat === this.mySeat; }
  /** 지금 차례인 사람의 연결이 끊겨 판이 멈췄는지 */
  get stalled() { return this.currentSeat != null && !!this.left[this.currentSeat]; }

  /** 판 요약: 모든 판 · 점수 · 조각 · 광장 · 단계 · 밤 */
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
    this.hostLink.send({ type: 'intent', a: a });
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
    this._broadcast({ type: 'act', seq: this.seq, a: a, hash: this.hash() });
    this.onChange();
    return true;
  }

  // ---- 받은 말 ----

  // 방장: 참가자에게서 온 말. 그 참가자의 자리로만 행동할 수 있다
  _onPeerMessage(peer, msg) {
    if (!msg || typeof msg.type !== 'string' || peer.seat == null) return;
    if (msg.type === 'roll-intent') {
      this._hostRoll(peer.seat);
    } else if (msg.type === 'intent') {
      if (!this.game || this.g.done || this.currentSeat !== peer.seat || !Array.isArray(msg.a)) return;
      this._applyAndBroadcast(msg.a);
    }
  }

  // 참가자: 방장에게서 온 말
  _onHostMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if ((msg.type === 'lobby' || msg.type === 'roll-begin' || msg.type === 'start') && msg.v !== PROTOCOL) {
      this.onError('기기들의 앱 버전이 달라요. 모두 새로 고침해 주세요.');
      return;
    }
    if (msg.type === 'lobby') {
      this.lobbyCount = msg.count;
      this.onChange();
    } else if (msg.type === 'roll-begin') {
      this.names = msg.names;
      this.mySeat = msg.seat;
      this.roll = new FirstRoll(msg.names.length);
      this.game = null;
      this.left = {};
      this.desync = false;
      this.onChange();
    } else if (msg.type === 'roll') {
      if (this.rolling) this.roll.roll(msg.seat, msg.die);
      this.onChange();
    } else if (msg.type === 'start') {
      this._create(msg.seed, msg.names, Array.isArray(msg.firstOrder) ? msg.firstOrder : null);
      this.onChange();
    } else if (msg.type === 'left') {
      this.left[msg.seat] = true;
      if (this.names) this.onError(this.names[msg.seat] + '의 연결이 끊겼어요.');
      this.onChange();
    } else if (msg.type === 'act') {
      if (!this.game) return;
      if (msg.seq !== this.seq + 1) { this.desync = true; this.onError('행동 순서가 어긋났어요(' + this.seq + ' → ' + msg.seq + ').'); return; }
      this.seq = msg.seq;
      if (!this._apply(msg.a) || this.hash() !== msg.hash) {
        this.desync = true;
        this.onError('기기들의 판이 달라졌어요. 이 판은 다시 시작해 주세요.');
      }
      this.onChange();
    }
  }
}
