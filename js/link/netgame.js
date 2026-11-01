/*
 * js/link/netgame.js — 연결된 기기들이 한 판을 함께 두기(시험판, 2 - 5명)
 * ------------------------------------------------------------------
 * 판정은 자유 연습과 같은 MultiGame(→ engine.js)을 쓴다. 엔진은 시드가 같으면
 * 같은 주사위를 뽑으므로, 판 전체가 아니라 "행동"만 주고받으면 모든 기기의 판이 같아진다.
 *
 * 연결은 별 모양이다. 방장 기기가 참가자마다 연결(PeerLink)을 하나씩 갖고,
 * 참가자끼리는 직접 잇지 않는다. 방장이 판정의 기준이고 모든 소식을 전해 준다.
 *
 *   - 모이기: 참가자는 연결되자마자 { type: 'hello', name }으로 닉네임을 알리고,
 *     방장은 { type: 'lobby', v, count, names, nights, you }로 지금 모인 사람과 게임 길이를 알린다.
 *     you는 방장이 알고 있는 그 참가자의 이름이다. 다르면 참가자가 hello를 다시 보낸다.
 *   - 순서 정하기: 방장이 시작하면 자리를 정해(방장 0, 연결된 순서대로 1, 2 …) 참가자마다
 *     { type: 'roll-begin', v, names, seat, nights }를 보낸다. 굴리기는 방장이 대신 굴려
 *     { type: 'roll', seat, die }를 모두에게 알린다(참가자는 { type: 'roll-intent' }만 보낸다).
 *     같은 눈이면 그 사람들만 다시 굴린다(js/firstRoll.js).
 *   - 시작: 순서가 정해지면 { type: 'start', v, seed, names, firstOrder, nights }.
 *     게임 길이(nights)는 여덟 밤(8) 또는 스무하루 밤(21). 방장이 모이는 동안 고른다.
 *   - 방장 차례: 방장이 행동을 적용하고 { type: 'act', seq, a, hash }를 모두에게 보낸다.
 *   - 참가자 차례: 참가자는 { type: 'intent', a }만 보내고, 방장이 그 사람 차례인지 · 규칙에
 *     맞는지 확인해 적용한 뒤 'act'로 모두에게 돌려준다. 참가자는 'act'를 받았을 때만 적용한다.
 *   - hash: 적용한 뒤의 판 요약. 참가자가 자기 판과 비교해 어긋나면 알린다(desync).
 *   - 나감: 판 도중 참가자 연결이 끊기면 방장이 { type: 'left', seat }를 알린다.
 *     그 사람 차례가 오면 판이 멈추고, 방장이 남은 사람끼리 새 판을 시작할 수 있다.
 *   - 다시 들어오기: 방장이 끊긴 자리를 새 연결로 다시 받으면(readmit) 그 사람에게
 *     { type: 'resume', v, names, seat, nights, seed, firstOrder, log, rolls, hash }를 보낸다.
 *     방장은 시작부터의 행동(log)과 순서 정하기 굴림(rolls)을 모두 적어 두므로, 참가자는
 *     같은 시드로 처음부터 다시 둬서 같은 판을 만든다. 다른 사람들에게는 { type: 'back', seat }.
 *
 * 행동 a = [종류, 값...]
 *   ['place', pi, cell] · ['keep', cell] · ['eye', cell] · ['reward', key] · ['order', idx]
 *   ['blockedPool', pi] · ['blockedEye', cell]
 */
import { Engine } from '../engine.js';
import { MultiGame } from '../multi.js';
import { FirstRoll, rollDie } from '../firstRoll.js';

// 엔진이 같은 시드로 같은 판을 만들어야 하므로, 엔진 동작이나 주고받는 말이 바뀌면 올린다
// (2: 첫 순서 공정 섞기, 3: 주사위 굴려 순서 정하기, 4: 2 - 5명 · 모이기 · 자리 번호,
//  5: 닉네임 · 다시 들어오기, 6: 게임 길이 고르기)
export const PROTOCOL = 6;
/** 게임 길이: 여덟 밤(보드게임 그대로) · 스무하루 밤(1919년 2월 8일 - 28일, 스무하루의 밤과 같은 길이) */
export const NIGHT_OPTIONS = [8, 21];
function cleanNights(n) { return NIGHT_OPTIONS.indexOf(n) >= 0 ? n : 8; }
export const MAX_PLAYERS = 5;
export const NAME_MAX = 10;

/** 닉네임 다듬기: 앞뒤 공백 · 제어 문자를 빼고 10자까지. 비면 '' */
export function cleanName(name) {
  return String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
}

/** 자리 이름: 닉네임이 없으면 방장, 참가자 1, 참가자 2 … 같은 이름이 겹치면 뒤에 번호를 붙인다 */
export function seatNames(nicks) {
  const out = [];
  nicks.forEach(function (nick, i) {
    let name = cleanName(nick) || (i === 0 ? '방장' : '참가자 ' + i);
    let k = 2;
    const base = name;
    while (out.indexOf(name) >= 0) name = base + ' ' + (k++);
    out.push(name);
  });
  return out;
}

export class NetGame {
  /** @param isHost 방장이면 true(자리 0). 참가자의 자리는 순서 정하기를 시작할 때 방장이 알려 준다 */
  constructor(isHost, myName) {
    this.isHost = isHost;
    this.myName = cleanName(myName);
    this.mySeat = isHost ? 0 : null;
    this.peers = [];        // 방장: [{ link, id, seat, gone }]
    this.hostLink = null;   // 참가자: 방장과의 연결
    this.hostGone = false;
    this.lobbyCount = 1;    // 참가자: 방장이 알려 준 지금 인원
    this.lobbyNames = [];   // 참가자: 방장이 알려 준 지금 모인 사람 이름
    this.log = [];          // 방장: 이번 판의 모든 행동(다시 들어오는 사람에게 보냄)
    this.rollLog = [];      // 방장: 이번 순서 정하기의 모든 굴림
    this.names = null;
    this.nights = 8;        // 게임 길이(방장이 고름)
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
    this.onInfo = function () {};   // 좋은 소식(누가 다시 들어옴 등)
  }

  // ---- 연결 ----

  /** 방장: 연결된 참가자 하나를 더한다(모이는 동안) */
  addPeer(link) {
    const self = this;
    const peer = { link: link, id: ++this._peerNo, seat: null, gone: false, name: '' };
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
    link.send({ type: 'hello', name: this.myName });
  }

  /** 방장: 판(또는 순서 정하기) 도중 끊긴 자리를 새 연결로 다시 받는다 */
  readmit(link, seat) {
    if (!this.isHost || !this.left[seat] || !this.names) return false;
    const self = this;
    // 그 자리의 옛 연결은 버린다
    this.peers.forEach(function (p) { if (p.seat === seat) p.seat = null; });
    const peer = { link: link, id: ++this._peerNo, seat: seat, gone: false, name: this.names[seat] };
    this.peers.push(peer);
    link.on('message', function (msg) { self._onPeerMessage(peer, msg); });
    link.on('close', function () { self._onPeerClose(peer); });
    delete this.left[seat];
    const resume = { type: 'resume', v: PROTOCOL, names: this.names, seat: seat, nights: this.nights, rolls: this.rollLog };
    if (this.game) {
      resume.seed = this.pendingSeed;
      resume.firstOrder = this.firstOrder;
      resume.log = this.log;
      resume.hash = this.hash();
    }
    this._send(peer, resume);
    this.peers.forEach(function (p) { if (p !== peer && p.seat != null) self._send(p, { type: 'back', seat: seat }); });
    this.onChange();
    return true;
  }

  /** 방장: 지금 연결되어 있는 참가자 */
  get connectedPeers() { return this.peers.filter(function (p) { return !p.gone; }); }
  /** 방장: 모인 인원(방장 포함) */
  get gatheredCount() { return 1 + this.connectedPeers.length; }

  _send(peer, obj) { if (!peer.gone) peer.link.send(obj); }
  // 판에 앉은 참가자 모두에게(모이는 동안 새로 온 사람은 다음 판부터)
  _broadcast(obj) { const self = this; this.peers.forEach(function (p) { if (p.seat != null) self._send(p, obj); }); }
  /** 방장: 지금 모인 사람의 이름(방장, 연결된 참가자 순서) */
  lobbyNamesNow() {
    return seatNames([this.myName].concat(this.connectedPeers.map(function (p) { return p.name; })));
  }
  _sendLobby() {
    const count = this.gatheredCount;
    const names = this.lobbyNamesNow();
    const self = this;
    const nights = this.nights;
    // you: 방장이 알고 있는 그 사람의 이름. 참가자는 자기 이름과 다르면 hello를 다시 보낸다
    this.peers.forEach(function (p) { self._send(p, { type: 'lobby', v: PROTOCOL, count: count, names: names, nights: nights, you: p.name }); });
  }

  /** 방장: 게임 길이 고르기(모이는 동안 · 판과 판 사이) */
  setNights(n) {
    if (!this.isHost) return;
    this.nights = cleanNights(n);
    this._sendLobby();
    this.onChange();
  }

  _onPeerClose(peer) {
    if (peer.gone) return;
    peer.gone = true;
    if (peer.seat != null && (this.game || this.roll)) {
      this.left[peer.seat] = true;
      this._broadcast({ type: 'left', seat: peer.seat });
      const why = peer.link.closeReason ? ' — ' + peer.link.closeReason.replace(/\.$/, '') : '';
      if (this.rolling || (this.game && !this.g.done)) this.onError(this.names[peer.seat] + '의 연결이 끊겼어요' + why + '. [다시 받기]로 같은 자리에 돌아오게 하거나, 남은 사람끼리 새 판을 시작할 수 있어요.');
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
    this.names = seatNames([this.myName].concat(peers.map(function (p) { return p.name; })));
    this.pendingSeed = seed;
    this.firstOrder = null;
    this.log = [];
    this.rollLog = [];
    this.roll = new FirstRoll(this.names.length);
    this.game = null;
    this.left = {};
    this.desync = false;
    const self = this;
    peers.forEach(function (p) { self._send(p, { type: 'roll-begin', v: PROTOCOL, names: self.names, seat: p.seat, nights: self.nights }); });
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
    this.rollLog.push({ seat: seat, die: die });
    this._broadcast({ type: 'roll', seat: seat, die: die });
    if (this.roll.done) {
      const order = this.roll.order();
      this.firstOrder = order;
      this._create(this.pendingSeed, this.names, order);
      this._broadcast({ type: 'start', v: PROTOCOL, seed: this.pendingSeed, names: this.names, firstOrder: order, nights: this.nights });
    }
    this.onChange();
    return true;
  }

  _create(seed, names, firstOrder) {
    this.names = names;
    this.game = new MultiGame({ seed: seed, nights: this.nights }, names.map(function (n) { return { type: 'human', name: n }; }), firstOrder);
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
    this.log.push(a);
    this.seq++;
    this._broadcast({ type: 'act', seq: this.seq, a: a, hash: this.hash() });
    this.onChange();
    return true;
  }

  // ---- 받은 말 ----

  // 방장: 참가자에게서 온 말. 그 참가자의 자리로만 행동할 수 있다
  _onPeerMessage(peer, msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hello') {
      // 모이는 동안에만 이름을 받는다(판 도중 다시 들어온 사람은 원래 자리 이름 그대로)
      if (peer.seat == null) { peer.name = cleanName(msg.name); peer.link.setLabel && peer.link.setLabel(peer.name || '참가자'); this._sendLobby(); this.onChange(); }
      return;
    }
    if (peer.seat == null) return;
    if (msg.type === 'roll-intent') {
      this._hostRoll(peer.seat);
    } else if (msg.type === 'intent') {
      if (!this.game || this.g.done || this.currentSeat !== peer.seat || !Array.isArray(msg.a)) return;
      this._applyAndBroadcast(msg.a);
    }
  }

  // 참가자: 다시 들어왔을 때 — 순서 정하기 굴림과 판의 행동을 처음부터 다시 둬서 같은 판을 만든다
  _resume(msg) {
    this.names = msg.names.map(cleanName);
    this.nights = cleanNights(msg.nights);
    this.mySeat = msg.seat;
    this.left = {};
    this.desync = false;
    this.roll = new FirstRoll(this.names.length);
    const roll = this.roll;
    (msg.rolls || []).forEach(function (r) { roll.roll(r.seat, r.die); });
    this.game = null;
    if (msg.seed != null) {
      this._create(msg.seed, this.names, Array.isArray(msg.firstOrder) ? msg.firstOrder : null);
      const self = this;
      let ok = true;
      (msg.log || []).forEach(function (a) { if (ok && !self._apply(a)) ok = false; });
      this.seq = (msg.log || []).length;
      if (!ok || this.hash() !== msg.hash) {
        this.desync = true;
        this.onError('다시 들어왔지만 판을 똑같이 만들지 못했어요. 방장이 새 판을 시작해 주세요.');
      }
    }
    this.onChange();
  }

  // 참가자: 방장에게서 온 말
  _onHostMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if ((msg.type === 'lobby' || msg.type === 'roll-begin' || msg.type === 'start' || msg.type === 'resume') && msg.v !== PROTOCOL) {
      this.onError('기기들의 앱 버전이 달라요. 모두 새로 고침해 주세요.');
      return;
    }
    if (msg.type === 'lobby') {
      this.lobbyCount = msg.count;
      this.lobbyNames = Array.isArray(msg.names) ? msg.names.map(cleanName) : [];
      this.nights = cleanNights(msg.nights);
      if (this.myName && cleanName(msg.you) !== this.myName && this.hostLink) this.hostLink.send({ type: 'hello', name: this.myName });
      this.onChange();
    } else if (msg.type === 'resume') {
      this._resume(msg);
    } else if (msg.type === 'back') {
      delete this.left[msg.seat];
      if (this.names) this.onInfo(this.names[msg.seat] + '이(가) 다시 들어왔어요.');
      this.onChange();
    } else if (msg.type === 'roll-begin') {
      this.names = msg.names.map(cleanName);
      this.nights = cleanNights(msg.nights);
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
      this.nights = cleanNights(msg.nights);
      this._create(msg.seed, msg.names.map(cleanName), Array.isArray(msg.firstOrder) ? msg.firstOrder : null);
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
