/*
 * js/link/linkui.js — 기기끼리 함께하기(link.html) 화면 · 입력(시험판)
 * ------------------------------------------------------------------
 * 연결: rtc.js(PeerLink) + qr.js(그리기 · 카메라 읽기), 판 맞추기: netgame.js
 * 판 그림은 본 게임과 같은 주사위 그림(art.js)을 쓴다.
 */
import { PeerLink } from './rtc.js';
import { drawQR, scanQR } from './qr.js';
import { NetGame } from './netgame.js';
import { Engine } from '../engine.js';
import { dieIcon } from '../art.js';
import { randomSeed } from '../levelSetup.js';

const PIECE_NAME = { taegeuk: '태극', geon: '건', ri: '리', gam: '감', gon: '곤' };
const PIECE_ORDER = ['taegeuk', 'geon', 'ri', 'gam', 'gon'];
const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };
const NAMES = ['방장', '참가자'];

const state = {
  link: null,
  net: null,
  isHost: false,
  selectedPi: null, // 내 차례에 고른 광장 주사위
  scan: null        // 열려 있는 카메라
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

// ---- 연결 ----
function newLink() {
  if (state.link) state.link.close();
  const link = new PeerLink();
  state.link = link;
  link.on('open', function () {
    if (state.link !== link) return;
    notice(null);
    startNet();
  });
  link.on('close', function (reason) {
    if (state.link !== link) return;
    $('status').classList.add('off');
    $('status-text').textContent = '연결 끊김';
    notice((reason || '연결이 끊겼어요.') + ' 처음부터 다시 연결해 주세요.');
    renderPlay();
  });
  return link;
}

async function startHost() {
  state.isHost = true;
  show('step-host');
  notice(null);
  $('btn-host-scan').disabled = true;
  try {
    const code = await newLink().createOffer();
    putQR('host-qr', code);
    $('host-code').value = code;
    $('btn-host-scan').disabled = false;
  } catch (e) {
    $('host-qr').innerHTML = '';
    notice(e.message || '연결 코드를 만들지 못했어요.');
  }
}

async function hostAcceptAnswer(code) {
  try {
    await state.link.acceptAnswer(code);
    notice('답장을 받았어요. 연결하는 중…', 'ok');
  } catch (e) {
    notice(e.message || '답장 코드를 읽지 못했어요.');
  }
}

function startGuest() {
  state.isHost = false;
  show('step-guest');
  notice(null);
  $('guest-scan-card').hidden = false;
  $('guest-answer-card').hidden = true;
}

async function guestAcceptOffer(code) {
  try {
    const answer = await newLink().acceptOffer(code);
    putQR('guest-qr', answer);
    $('guest-code').value = answer;
    $('guest-scan-card').hidden = true;
    $('guest-answer-card').hidden = false;
    notice(null);
  } catch (e) {
    notice(e.message || '방장의 코드를 읽지 못했어요.');
  }
}

function startNet() {
  const net = new NetGame(state.link, state.isHost);
  state.net = net;
  state.selectedPi = null;
  net.onChange = function () { state.selectedPi = null; renderPlay(); };
  net.onError = function (msg) { notice(msg); };
  show('step-play');
  $('status').classList.remove('off');
  $('status-text').textContent = '연결됨 · 나는 ' + NAMES[net.mySeat];
  if (state.isHost) net.start(randomSeed(), NAMES);
  renderPlay();
}

// ---- 함께 두기 화면 ----
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
  if (net && net.rolling) { renderRoll(); return; }
  if (!net || !net.game) { body.innerHTML = '<p class="muted">방장이 판을 여는 중…</p>'; return; }
  const g = net.g;
  const game = net.game;
  const me = g.players[net.mySeat];
  const them = g.players[1 - net.mySeat];
  const cur = net.currentSeat;
  const online = state.link && !state.link.closed;
  const myTurn = online && net.isMyTurn && !net.desync;
  const snap = myTurn ? game.snapshot() : null;
  $('night').textContent = g.done ? '끝' : g.round + ' / 8번째 밤';

  // 차례 안내
  let turn, phaseText = '';
  if (g.done) {
    const st = game.standings();
    turn = '<b>여덟 밤이 지났어요.</b> ' + (st[0].score === st[1].score ? '같은 점수예요(나중에 그 점수에 올라선 쪽이 앞서요). ' : '') + st[0].name + ' 승리 · ' + st.map(function (p) { return p.name + ' ' + p.score + '점'; }).join(' · ');
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
  } else {
    turn = online ? them.name + ' 차례 · 기다리는 중…' : '연결이 끊겨 진행할 수 없어요.';
  }

  const pl = function (p) {
    return '<div class="pl' + (cur === p.id ? ' cur' : '') + '"><span class="nm">' + p.name + (p.id === net.mySeat ? ' (나)' : '') + '</span><span class="sc">' + p.score + '</span></div>';
  };

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

  body.innerHTML =
    '<div class="turn' + (myTurn ? '' : ' wait') + '">' + turn + '</div>' +
    '<div class="players">' + pl(g.players[0]) + pl(g.players[1]) + '</div>' +
    '<div class="boards">' +
      '<div class="board-col mine"><div class="board-label">내 판</div>' + boardHtml(me.board, 'mine', opts) + '</div>' +
      '<div class="board-col theirs"><div class="board-label">' + them.name + '의 판</div>' + boardHtml(them.board, 'theirs', { size: 30, pulse: net.lastSeat === them.id ? net.lastCell : null }) + '</div>' +
    '</div>' +
    (g.done ? '' : '<div class="pool">' + pool + '</div>') +
    (choices ? '<div class="opts">' + choices + '</div>' : '') +
    '<div class="pieces">내 조각 ' + PIECE_ORDER.map(function (k) { return PIECE_NAME[k] + ' ' + me.parts[k]; }).join(' · ') + ' · 태극기 ' + Engine.flagsOf(me) + '장</div>' +
    (g.done && state.isHost && online ? '<button class="primary" id="btn-again">새 판 시작</button>' : '') +
    (g.done && !state.isHost && online ? '<p class="muted" style="text-align:center">방장이 새 판을 시작할 수 있어요.</p>' : '') +
    '<p class="muted" style="text-align:center">시험판 · 판 확인 번호 ' + net.seq + (net.desync ? ' · 판이 어긋났어요' : '') + '</p>';
}

// 첫 밤 순서 정하기: 둘 다 주사위를 굴려 눈이 큰 사람이 먼저(같으면 다시)
function renderRoll() {
  const net = state.net;
  const r = net.roll;
  const online = state.link && !state.link.closed;
  const ranks = r.ranks();
  const tied = r.rerolls > 0 && !r.done && r.active.length;
  $('night').textContent = '순서 정하기';
  let turn;
  if (net.myRollNeeded && online) turn = '<b>주사위를 굴려요.</b> 눈이 큰 사람이 첫 밤에 먼저 골라요(밀정은 가장 작은 눈).' + (tied ? ' 같은 눈이라 다시 굴려요!' : '');
  else turn = online ? (tied ? '같은 눈이에요. ' : '') + '상대가 굴리기를 기다리는 중…' : '연결이 끊겨 진행할 수 없어요.';
  const rows = [0, 1].map(function (seat) {
    const face = r.faces[seat];
    const name = net.names[seat] + (seat === net.mySeat ? ' (나)' : '');
    const needs = r.needs(seat);
    return '<div class="pl' + (needs ? ' cur' : '') + '" style="min-height:64px">' +
      '<span class="nm">' + (ranks[seat] && !needs ? ranks[seat] + '위 · ' : '') + name + '</span>' +
      (face ? dieIcon(face.color, face.value, 46) : '<span class="muted">' + (needs ? '굴릴 차례' : '') + '</span>') + '</div>';
  }).join('');
  $('play-body').innerHTML =
    '<div class="turn' + (net.myRollNeeded && online ? '' : ' wait') + '">' + turn + '</div>' +
    '<div class="stack">' + rows + '</div>' +
    (net.myRollNeeded && online ? '<button class="primary" id="btn-roll">' + (r.history[net.mySeat].length ? '다시 굴리기' : '주사위 굴리기') + '</button>' : '');
}

function onPlayClick(e) {
  const net = state.net;
  if (!net) return;
  if (e.target.closest('#btn-roll')) { net.rollMine(); return; }
  if (!net.game) return;
  // 판이 끝나면 누구 차례도 아니므로, 새 판 버튼은 차례 확인보다 먼저 본다
  if (e.target.closest('#btn-again')) { net.start(randomSeed(), NAMES); return; }
  if (!net.isMyTurn || net.desync) return;
  const g = net.g;
  const die = e.target.closest('.pool button[data-pi]');
  if (die && !die.disabled) {
    const pi = Number(die.dataset.pi);
    if (g.phase === 'blocked_pool') { net.act(['blockedPool', pi]); return; }
    state.selectedPi = state.selectedPi === pi ? null : pi;
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
