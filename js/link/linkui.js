/*
 * js/link/linkui.js — 기기끼리 함께하기(link.html) 화면 · 입력(시험판, 2 - 5명)
 * ------------------------------------------------------------------
 * 연결: rtc.js(PeerLink) + qr.js(그리기 · 카메라 읽기), 판 맞추기: netgame.js
 * 방장은 참가자를 한 사람씩 QR로 받아(최대 4명) 모은 뒤 시작한다.
 * 판 그림은 본 게임과 같은 주사위 그림(art.js)을, 소리는 같은 배경음 · 북소리(audio.js)와
 * 설정(배경음 · 효과음 켜고 끄기)을 쓴다.
 */
import { PeerLink } from './rtc.js';
import { drawQR, scanQR } from './qr.js';
import { NetGame, MAX_PLAYERS, seatNames } from './netgame.js';
import { Engine } from '../engine.js';
import { dieIcon } from '../art.js';
import { randomSeed } from '../levelSetup.js';
import { Sound } from '../audio.js';
import { getSettings } from '../solo.js';

const PIECE_NAME = { taegeuk: '태극', geon: '건', ri: '리', gam: '감', gon: '곤' };
const PIECE_ORDER = ['taegeuk', 'geon', 'ri', 'gam', 'gon'];
const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };

const state = {
  net: null,
  isHost: false,
  invite: null,     // 방장: 지금 받는 중인 참가자와의 연결(아직 열리지 않음)
  guestLink: null,  // 참가자: 방장과의 연결
  selectedPi: null, // 내 차례에 고른 광장 주사위
  scan: null,       // 열려 있는 카메라
  heard: null       // 소리용: 마지막으로 본 판의 기록(누가 무엇을 했는지 비교)
};

const $ = function (id) { return document.getElementById(id); };

function show(step) {
  ['step-home', 'step-host', 'step-guest', 'step-play'].forEach(function (id) { $(id).hidden = id !== step; });
  window.scrollTo(0, 0);
}

function notice(msg, kind) {
  const el = $('notice');
  if (!msg) { el.hidden = true; return; }
  el.className = 'notice ' + (kind || 'err');
  el.textContent = msg;
  el.hidden = false;
}

function putQR(boxId, code) {
  const box = $(boxId);
  box.innerHTML = '';
  const canvas = drawQR(code, 640);
  box.appendChild(canvas);
  const info = document.createElement('div');
  info.className = 'info';
  info.textContent = '코드 ' + code.length + '자 · QR ' + canvas.dataset.version + '형(' + canvas.dataset.modules + '칸)';
  box.appendChild(info);
}

async function copyText(id) {
  const el = $(id);
  try { await navigator.clipboard.writeText(el.value); notice('코드를 복사했어요.', 'ok'); }
  catch (e) { el.select(); try { document.execCommand('copy'); notice('코드를 복사했어요.', 'ok'); } catch (e2) { notice('복사하지 못했어요. 코드를 길게 눌러 직접 복사해 주세요.'); } }
}

// ---- 카메라 ----
function openCamera(text, accept) {
  closeCamera();
  $('camera').hidden = false;
  $('camera-text').textContent = text;
  state.scan = scanQR($('camera-video'), accept);
  return state.scan.promise.finally(function () { $('camera').hidden = true; state.scan = null; });
}
function closeCamera() {
  if (state.scan) state.scan.cancel();
}

// ---- 방장: 참가자를 한 사람씩 받기 ----
function makeNet(isHost) {
  const net = new NetGame(isHost);
  state.net = net;
  state.selectedPi = null;
  state.heard = null;
  net.onChange = function () {
    state.selectedPi = null;
    playNetSounds();
    // 순서 정하기나 판이 진행 중이면 판 화면으로. 방장이 모으는 중(지난 판이 끝난 뒤 포함)이면 모으기 화면 그대로
    const playing = net.rolling || (net.game && !net.g.done);
    if (state.isHost && !$('step-host').hidden && !playing) { renderLobby(); return; }
    if ($('step-play').hidden && playing) show('step-play');
    if (!$('step-play').hidden) renderPlay();
  };
  net.onError = function (msg) { notice(msg); };
  return net;
}

function startHost() {
  state.isHost = true;
  if (!state.net) makeNet(true);
  show('step-host');
  notice(null);
  renderLobby();
  if (state.net.gatheredCount < 2) newInvite();
}

// 다음 참가자를 받을 연결을 만든다(이전에 받던 연결이 안 열렸으면 닫는다)
async function newInvite() {
  const net = state.net;
  if (net.gatheredCount >= MAX_PLAYERS) return;
  if (state.invite) state.invite.close();
  const link = new PeerLink();
  state.invite = link;
  const no = net.gatheredCount; // 이번에 받는 참가자 번호(1부터)
  $('invite-title').textContent = '참가자 ' + no + ' 받기';
  $('host-invite').hidden = false;
  $('host-qr').innerHTML = '<p class="muted">연결 코드를 만드는 중…</p>';
  $('host-code').value = '';
  $('host-answer').value = '';
  $('btn-host-scan').disabled = true;
  link.on('open', function () {
    if (state.invite !== link) return;
    state.invite = null;
    net.addPeer(link);
    notice('참가자 ' + no + '이(가) 연결됐어요. 더 받으려면 [한 명 더 받기], 다 모였으면 [시작하기]를 눌러요.', 'ok');
    renderLobby();
  });
  renderLobby();
  try {
    const code = await link.createOffer();
    if (state.invite !== link) return;
    putQR('host-qr', code);
    $('host-code').value = code;
    $('btn-host-scan').disabled = false;
  } catch (e) {
    $('host-qr').innerHTML = '';
    notice(e.message || '연결 코드를 만들지 못했어요.');
  }
}

async function hostAcceptAnswer(code) {
  if (!state.invite) return;
  try {
    await state.invite.acceptAnswer(code);
    notice('답장을 받았어요. 연결하는 중…', 'ok');
  } catch (e) {
    notice(e.message || '답장 코드를 읽지 못했어요.');
  }
}

function renderLobby() {
  const net = state.net;
  if (!net) return;
  const n = net.gatheredCount;
  $('lobby-count').textContent = n + ' / ' + MAX_PLAYERS + '명';
  const names = seatNames(n);
  let html = '<div class="seat"><span class="nm">방장 (나)</span><span class="st">준비됨</span></div>';
  net.connectedPeers.forEach(function (p, i) {
    html += '<div class="seat"><span class="nm">' + names[i + 1] + '</span><span class="st">연결됨</span></div>';
  });
  if (state.invite) html += '<div class="seat wait"><span class="nm">참가자 ' + n + '</span><span class="st">QR로 받는 중…</span></div>';
  $('lobby-list').innerHTML = html;
  $('host-invite').hidden = !state.invite;
  $('btn-invite').hidden = !!state.invite || n >= MAX_PLAYERS;
  $('btn-start').disabled = n < 2;
  $('btn-start').textContent = n < 2 ? '참가자가 오면 시작할 수 있어요' : n + '명으로 시작하기';
}

function hostStart() {
  const net = state.net;
  if (!net || net.gatheredCount < 2) return;
  if (state.invite) { state.invite.close(); state.invite = null; }
  notice(null);
  show('step-play');
  setStatus();
  net.start(randomSeed());
}

// ---- 참가자 ----
function startGuest() {
  state.isHost = false;
  show('step-guest');
  notice(null);
  $('guest-scan-card').hidden = false;
  $('guest-answer-card').hidden = true;
}

async function guestAcceptOffer(code) {
  if (state.guestLink) state.guestLink.close();
  const link = new PeerLink();
  state.guestLink = link;
  link.on('open', function () {
    if (state.guestLink !== link) return;
    const net = makeNet(false);
    net.attachHost(link);
    notice(null);
    show('step-play');
    setStatus();
    renderPlay();
  });
  try {
    const answer = await link.acceptOffer(code);
    putQR('guest-qr', answer);
    $('guest-code').value = answer;
    $('guest-scan-card').hidden = true;
    $('guest-answer-card').hidden = false;
    notice(null);
  } catch (e) {
    notice(e.message || '방장의 코드를 읽지 못했어요.');
  }
}

// ---- 함께 두기 화면 ----
function online() {
  const net = state.net;
  return !!net && (net.isHost ? true : !net.hostGone);
}

function setStatus() {
  const net = state.net;
  if (!net) return;
  const off = !net.isHost && net.hostGone;
  $('status').classList.toggle('off', off);
  const me = net.names && net.mySeat != null ? net.names[net.mySeat] : (net.isHost ? '방장' : '참가자');
  $('status-text').textContent = off ? '방장과 연결 끊김' : '연결됨 · 나는 ' + me;
}

function boardHtml(board, cls, opts) {
  opts = opts || {};
  let html = '<div class="board ' + cls + '">';
  for (let i = 0; i < 9; i++) {
    const d = board[i];
    const c = ['cell'];
    if (opts.valid && opts.valid.indexOf(i) >= 0) c.push('valid');
    if (opts.choosable && opts.choosable.indexOf(i) >= 0) c.push('choosable');
    if (opts.pulse === i) c.push('pulse');
    html += '<div class="' + c.join(' ') + '"' + (opts.clickable ? ' data-cell="' + i + '"' : '') + '>' + (d ? dieIcon(d.color, d.value, opts.size || 50) : '') + '</div>';
  }
  return html + '</div>';
}

function renderPlay() {
  const net = state.net;
  const body = $('play-body');
  setStatus();
  if (net && net.rolling) { renderRoll(); return; }
  if (!net || !net.game) {
    const count = net ? net.lobbyCount : 1;
    $('night').textContent = '모이는 중';
    body.innerHTML = '<div class="turn wait">방장이 <b>시작하기</b>를 누르기를 기다리는 중… · 지금 ' + count + '명 모였어요(최대 ' + MAX_PLAYERS + '명).</div>';
    return;
  }
  const g = net.g;
  const game = net.game;
  const n = g.players.length;
  const me = g.players[net.mySeat];
  const others = g.players.filter(function (p) { return p.id !== net.mySeat; });
  const cur = net.currentSeat;
  const live = online();
  const myTurn = live && net.isMyTurn && !net.desync;
  const snap = myTurn ? game.snapshot() : null;
  $('night').textContent = g.done ? '끝' : g.round + ' / 8번째 밤';

  // 차례 안내
  let turn, phaseText = '';
  if (g.done) {
    const st = game.standings();
    turn = '<b>여덟 밤이 지났어요.</b> ' + st[0].name + ' 승리 · ' + st.map(function (p, i) { return (i + 1) + '위 ' + p.name + ' ' + p.score + '점'; }).join(' · ') +
      (st.length > 1 && st[0].score === st[1].score ? ' (같은 점수면 나중에 그 점수에 올라선 사람이 앞서요)' : '');
  } else if (myTurn) {
    const ph = g.phase;
    if (ph === 'place') phaseText = state.selectedPi == null ? '광장에서 사람을 골라요.' : '빨간 테두리 칸에 놓아요.';
    else if (ph === 'combo_keep') phaseText = '모둠 중 남길 한 사람을 골라요.';
    else if (ph === 'combo_eye') phaseText = '쫓아낼 밀정을 골라요(+1점).';
    else if (ph === 'combo_reward') phaseText = '받을 조각을 골라요.';
    else if (ph === 'combo_order') phaseText = '교차 완성! 어느 보상을 먼저 받을까요?';
    else if (ph === 'blocked_pool') phaseText = '놓을 곳이 없어요. 돌려보낼 사람을 골라요.';
    else if (ph === 'blocked_eye') phaseText = '치울 밀정을 골라요.';
    turn = '<b>내 차례</b> · 남은 배치 ' + (2 - g.placementsThisTurn) + '번 · ' + phaseText;
  } else if (!live) {
    turn = '방장과 연결이 끊겨 진행할 수 없어요.';
  } else if (net.stalled) {
    turn = g.players[cur].name + '의 연결이 끊겨 판이 멈췄어요.' + (net.isHost ? ' 아래에서 남은 사람끼리 새 판을 시작할 수 있어요.' : ' 방장이 새 판을 시작할 때까지 기다려 주세요.');
  } else {
    turn = g.players[cur].name + ' 차례 · 기다리는 중…';
  }

  // 이번 밤 고르는 순서대로 사람 카드(이미 둔 사람은 흐리게)
  const players = g.order.map(function (id, k) {
    const p = g.players[id];
    const cls = 'pl' + (cur === id ? ' cur' : '') + (!g.done && k < g.orderAt ? ' done' : '') + (net.left[id] ? ' gone' : '');
    return '<div class="' + cls + '"><span class="nm">' + p.name + (id === net.mySeat ? ' (나)' : '') + '</span><span class="sc">' + p.score + '</span></div>';
  }).join('');

  // 내 판에서 누를 수 있는 칸
  const opts = { clickable: myTurn, size: 54 };
  if (myTurn && g.phase === 'place' && state.selectedPi != null) opts.valid = Engine.validCells(me.board);
  if (myTurn && g.phase === 'combo_keep') opts.choosable = snap.keepLine;
  if (myTurn && (g.phase === 'combo_eye' || g.phase === 'blocked_eye')) opts.choosable = snap.eyeOptions;
  if (net.lastSeat === net.mySeat) opts.pulse = net.lastCell;

  const poolClickable = myTurn && (g.phase === 'place' || g.phase === 'blocked_pool');
  const pool = g.pool.map(function (d, i) {
    return '<button data-pi="' + i + '" class="' + (state.selectedPi === i ? 'sel' : '') + '" ' + (poolClickable ? '' : 'disabled') + '>' + dieIcon(d.color, d.value, 54) + '</button>';
  }).join('');

  let choices = '';
  if (myTurn && g.phase === 'combo_reward') {
    choices = snap.rewardOptions.map(function (k) { return '<button data-reward="' + k + '">' + PIECE_NAME[k] + ' (' + me.parts[k] + ')</button>'; }).join('');
  } else if (myTurn && g.phase === 'combo_order') {
    choices = snap.comboOrderOptions.map(function (o) { return '<button data-order="' + o.idx + '">' + COMBO_NAME[o.type] + '</button>'; }).join('');
  }

  // 다른 사람들의 판: 둘이면 옆에, 셋 이상이면 내 판 아래에 줄지어
  const otherBoard = function (p, cls) {
    return '<div class="board-col' + (cls ? ' ' + cls : '') + '"><div class="board-label">' + p.name + ' · ' + p.score + '점</div>' +
      boardHtml(p.board, 'theirs', { size: 30, pulse: net.lastSeat === p.id ? net.lastCell : null }) + '</div>';
  };
  let boards;
  if (n === 2) {
    boards = '<div class="boards"><div class="board-col mine"><div class="board-label">내 판</div>' + boardHtml(me.board, 'mine', opts) + '</div>' +
      otherBoard(others[0], 'theirs') + '</div>';
  } else {
    boards = '<div class="mine-wrap"><div class="board-label">내 판</div>' + boardHtml(me.board, 'mine', opts) + '</div>' +
      '<div class="others" style="grid-template-columns: repeat(' + Math.min(others.length, 4) + ', minmax(0, 1fr))">' + others.map(function (p) { return otherBoard(p); }).join('') + '</div>';
  }

  const canRestart = net.isHost && (g.done || net.stalled);
  body.innerHTML =
    '<div class="turn' + (myTurn ? '' : ' wait') + '">' + turn + '</div>' +
    '<div class="players' + (n > 2 ? ' many' : '') + '">' + (g.done ? '' : '<div class="order">이번 밤 고르는 순서 →</div>') + players + '</div>' +
    boards +
    (g.done ? '' : '<div class="pool">' + pool + '</div>') +
    (choices ? '<div class="opts">' + choices + '</div>' : '') +
    '<div class="pieces">내 조각 ' + PIECE_ORDER.map(function (k) { return PIECE_NAME[k] + ' ' + me.parts[k]; }).join(' · ') + ' · 태극기 ' + Engine.flagsOf(me) + '장</div>' +
    (canRestart ? '<div class="row"><button class="primary" id="btn-again">' + (net.gatheredCount >= 2 ? net.gatheredCount + '명으로 새 판' : '새 판(사람이 더 필요해요)') + '</button>' +
      (net.gatheredCount < MAX_PLAYERS ? '<button id="btn-more">사람 더 받기</button>' : '') + '</div>' : '') +
    (g.done && !net.isHost && live ? '<p class="muted" style="text-align:center">방장이 새 판을 시작할 수 있어요.</p>' : '') +
    '<p class="muted" style="text-align:center">시험판 · ' + n + '명 · 판 확인 번호 ' + net.seq + (net.desync ? ' · 판이 어긋났어요' : '') + '</p>';
}

// 첫 밤 순서 정하기: 모두 주사위를 굴려 눈이 큰 사람부터(같으면 그 사람들만 다시)
function renderRoll() {
  const net = state.net;
  const r = net.roll;
  const live = online();
  const ranks = r.ranks();
  const tied = r.rerolls > 0 && !r.done && r.active.length;
  $('night').textContent = '순서 정하기';
  let turn;
  if (net.myRollNeeded && live) turn = '<b>주사위를 굴려요.</b> 눈이 큰 사람부터 첫 밤에 먼저 골라요(밀정은 가장 작은 눈).' + (tied ? ' 같은 눈이라 다시 굴려요!' : '');
  else if (!live) turn = '방장과 연결이 끊겨 진행할 수 없어요.';
  else turn = (tied ? '같은 눈이 나와 그 사람들만 다시 굴려요. ' : '') + '다른 사람이 굴리기를 기다리는 중…';
  const rows = net.names.map(function (name, seat) {
    const face = r.faces[seat];
    const needs = r.needs(seat);
    const label = (ranks[seat] && !needs ? ranks[seat] + '위 · ' : '') + name + (seat === net.mySeat ? ' (나)' : '');
    return '<div class="pl' + (needs ? ' cur' : '') + (net.left[seat] ? ' gone' : '') + '" style="min-height:60px">' +
      '<span class="nm">' + label + '</span>' +
      (face ? '<span class="muted">눈 ' + r.history[seat].join(' → ') + '</span>' + dieIcon(face.color, face.value, 44) : '<span class="muted">' + (needs ? '굴릴 차례' : '') + '</span>') + '</div>';
  }).join('');
  const canRestart = net.isHost && Object.keys(net.left).length > 0;
  $('play-body').innerHTML =
    '<div class="turn' + (net.myRollNeeded && live ? '' : ' wait') + '">' + turn + '</div>' +
    '<div class="stack">' + rows + '</div>' +
    (net.myRollNeeded && live ? '<button class="primary" id="btn-roll">' + (r.history[net.mySeat].length ? '다시 굴리기' : '주사위 굴리기') + '</button>' : '') +
    (canRestart ? '<button id="btn-again">' + (net.gatheredCount >= 2 ? '남은 ' + net.gatheredCount + '명으로 다시 시작' : '새 판(사람이 더 필요해요)') + '</button>' : '');
}

// ---- 소리 ----
// 판이 바뀔 때마다(내 행동이든 남의 행동이든) 전과 비교해 일어난 일에 맞는 북 장단을 친다.
// 본 게임(ui.js의 playActionSounds)과 같은 순서 · 같은 장단
function heardState() {
  const net = state.net;
  if (!net) return null;
  if (net.rolling) return { rolling: true, rolled: net.roll.history.reduce(function (n, h) { return n + h.length; }, 0) + Object.keys(net.roll.current).length, done: false };
  const g = net.g;
  if (!g) return null;
  const sum = { placements: 0, same: 0, consec: 0, color: 0, scatterLines: 0, withdrawn: 0, blocked: 0, eyesRemoved: 0, pieces: 0, flags: 0 };
  g.players.forEach(function (p) {
    Object.keys(sum).forEach(function (k) { if (p.stats[k] != null) sum[k] += p.stats[k]; });
    sum.pieces += Engine.pieceTotal(p);
    sum.flags += Engine.flagsOf(p);
  });
  return { game: net.game, round: g.round, done: g.done, s: sum };
}

function playNetSounds() {
  const before = state.heard;
  const after = heardState();
  state.heard = after;
  if (!after) return;
  if (after.rolling) {
    if (!before || !before.rolling) Sound.play('select');
    else if (after.rolled !== before.rolled) Sound.play('place');
    return;
  }
  if (!before || before.rolling || before.game !== after.game) { Sound.play('night'); return; } // 새 판
  const b = before.s, a = after.s;
  let d = 0;
  const next = function (name, gap) { Sound.play(name, d); d += Sound.span(name) + gap; };
  if (a.placements > b.placements) next('place', 0.18);
  if (a.same + a.consec + a.color > b.same + b.consec + b.color) next('combo', 0.3);
  if (a.eyesRemoved > b.eyesRemoved) next('eye', 0.25);
  if (a.flags > b.flags) next('flag', 0.3);
  else if (a.pieces > b.pieces) next('reward', 0.25);
  if (a.scatterLines > b.scatterLines) next('scatter', 0.25);
  if (a.withdrawn > b.withdrawn) next('withdraw', 0.25);
  if (a.blocked > b.blocked) next('blocked', 0.25);
  if (d === 0 && !after.done && after.round === before.round) Sound.play('select'); // 남길 사람 고르기 등
  if (after.done && !before.done) Sound.play('dawn', d + 0.3);
  else if (after.round > before.round) Sound.play('night', d + 0.3);
}

function applySoundSettings() {
  const st = getSettings();
  Sound.configure({ bgm: st.bgm !== false, sfx: st.sfx !== false });
}

function onPlayClick(e) {
  const net = state.net;
  if (!net) return;
  if (e.target.closest('#btn-roll')) { net.rollMine(); return; }
  if (e.target.closest('#btn-again')) {
    if (net.gatheredCount < 2) { startHost(); return; }
    notice(null);
    net.start(randomSeed());
    return;
  }
  if (e.target.closest('#btn-more')) { startHost(); if (!state.invite) newInvite(); return; }
  if (!net.game || !net.isMyTurn || net.desync) return;
  const g = net.g;
  const die = e.target.closest('.pool button[data-pi]');
  if (die && !die.disabled) {
    const pi = Number(die.dataset.pi);
    if (g.phase === 'blocked_pool') { net.act(['blockedPool', pi]); return; }
    state.selectedPi = state.selectedPi === pi ? null : pi;
    Sound.play('select');
    renderPlay();
    return;
  }
  const cell = e.target.closest('.board.mine .cell[data-cell]');
  if (cell) {
    const i = Number(cell.dataset.cell);
    if (g.phase === 'place') {
      if (state.selectedPi == null || Engine.validCells(g.players[net.mySeat].board).indexOf(i) < 0) return;
      net.act(['place', state.selectedPi, i]);
    } else if (g.phase === 'combo_keep') net.act(['keep', i]);
    else if (g.phase === 'combo_eye') net.act(['eye', i]);
    else if (g.phase === 'blocked_eye') net.act(['blockedEye', i]);
    return;
  }
  const rw = e.target.closest('[data-reward]');
  if (rw) { net.act(['reward', rw.dataset.reward]); return; }
  const od = e.target.closest('[data-order]');
  if (od) { net.act(['order', Number(od.dataset.order)]); }
}

function looksLikeCode(text) { return /^M[01][A-Za-z0-9_-]{20,}$/.test(String(text).trim()); }

function wire() {
  $('btn-host').addEventListener('click', startHost);
  $('btn-guest').addEventListener('click', startGuest);
  $('btn-invite').addEventListener('click', newInvite);
  $('btn-start').addEventListener('click', hostStart);
  $('btn-host-scan').addEventListener('click', function () {
    openCamera('참가자의 답장 QR을 화면 가운데에 맞춰 주세요.', looksLikeCode)
      .then(function (code) { if (code) hostAcceptAnswer(code); })
      .catch(function (e) { notice(e.message); });
  });
  $('btn-host-paste').addEventListener('click', function () { hostAcceptAnswer($('host-answer').value); });
  $('btn-guest-scan').addEventListener('click', function () {
    openCamera('방장의 QR을 화면 가운데에 맞춰 주세요.', looksLikeCode)
      .then(function (code) { if (code) guestAcceptOffer(code); })
      .catch(function (e) { notice(e.message); });
  });
  $('btn-guest-paste').addEventListener('click', function () { guestAcceptOffer($('guest-offer').value); });
  $('btn-camera-cancel').addEventListener('click', closeCamera);
  document.body.addEventListener('click', function (e) {
    if (e.target.closest('#step-home button, #step-host button, #step-guest button, #btn-camera-cancel, #btn-roll, #btn-again, #btn-more')) Sound.play('tap');
    const cp = e.target.closest('[data-copy]');
    if (cp) copyText(cp.dataset.copy);
  });
  $('play-body').addEventListener('click', onPlayClick);
}

// 이 화면만 열어도 오프라인 저장이 되도록(본 화면과 같은 sw.js)
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 무시: 오프라인 저장은 선택 사항 */ });
  }
}

wire();
registerServiceWorker();
// 소리: 브라우저는 첫 터치 뒤에만 소리를 낼 수 있다. 화면이 가려지면 배경음을 멈춘다
applySoundSettings();
document.addEventListener('pointerdown', function () { Sound.unlock(); }, { capture: true });
document.addEventListener('visibilitychange', function () { Sound.setHidden(document.hidden); });
// 화면을 닫거나 다른 곳으로 가면 연결을 바로 닫아, 남은 사람들이 곧바로 알 수 있게 한다
// (그냥 사라지면 WebRTC가 알아차리는 데 30초쯤 걸린다)
window.addEventListener('pagehide', function () {
  if (state.invite) state.invite.close();
  if (state.guestLink) state.guestLink.close();
  if (state.net) state.net.peers.forEach(function (p) { p.link.close(); });
});
