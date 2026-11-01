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
import { NetGame, MAX_PLAYERS, NIGHT_OPTIONS, cleanName } from './netgame.js';
import { ConnLog, deviceSummary } from './connlog.js';
import { Engine } from '../engine.js';
import { dieIcon, pieceIcon } from '../art.js';
import { nightDate } from '../story.js';
import { quickRulesHtml, ensureQuickRulesStyle } from '../quickRules.js';
import { randomSeed } from '../levelSetup.js';
import { Sound } from '../audio.js';
import { getSettings } from '../solo.js';

const PIECE_NAME = { taegeuk: '태극', geon: '건', ri: '리', gam: '감', gon: '곤' };
const PIECE_ORDER = ['taegeuk', 'geon', 'ri', 'gam', 'gon'];
const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };
const NAME_KEY = 'manse-eve:v1:linkName';
const NIGHTS_KEY = 'manse-eve:v1:linkNights';

const state = {
  net: null,
  isHost: false,
  invite: null,     // 방장: 지금 받는 중인 참가자와의 연결(아직 열리지 않음)
  inviteSeat: null, // 방장: 다시 받는 중이면 그 자리 번호(새 사람을 받는 중이면 null)
  wakeLock: null,   // 판 도중 화면이 꺼지지 않게(꺼지면 연결이 끊기기 쉽다)
  guestLink: null,  // 참가자: 방장과의 연결
  selectedPi: null, // 내 차례에 고른 광장 주사위
  scan: null,       // 열려 있는 카메라
  heard: null       // 소리용: 마지막으로 본 판의 기록(누가 무엇을 했는지 비교)
};

const $ = function (id) { return document.getElementById(id); };

// 닉네임은 다른 기기에서 온 글자이므로 화면에 넣기 전에 꼭 바꿔 둔다
function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function myName() {
  const v = cleanName($('my-name').value);
  try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* 무시 */ }
  return v;
}

function show(step) {
  ['step-home', 'step-host', 'step-guest', 'step-play'].forEach(function (id) { $(id).hidden = id !== step; });
  window.scrollTo(0, 0);
  if (step !== 'step-home') keepAwake();
}

// 연결 기록 패널: 펼쳐 둔 동안만 글자를 채운다
function renderLog() {
  $('log-summary').textContent = '연결 기록 (' + ConnLog.size + '줄)';
  if (!$('log-panel').open) return;
  const ta = $('log-text');
  const atEnd = ta.scrollTop + ta.clientHeight >= ta.scrollHeight - 4;
  ta.value = ConnLog.text();
  if (atEnd) ta.scrollTop = ta.scrollHeight;
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
  const net = new NetGame(isHost, myName());
  if (isHost) {
    let saved = 8;
    try { saved = Number(localStorage.getItem(NIGHTS_KEY)) || 8; } catch (e) { /* 무시 */ }
    net.nights = NIGHT_OPTIONS.indexOf(saved) >= 0 ? saved : 8;
  }
  state.net = net;
  state.selectedPi = null;
  state.heard = null;
  net.onChange = function () {
    state.selectedPi = null;
    playNetSounds();
    // 순서 정하기나 판이 진행 중이면 판 화면으로. 방장이 모으는 중(지난 판이 끝난 뒤 포함)이면 모으기 화면 그대로
    const playing = net.rolling || (net.game && !net.g.done);
    // 방장이 사람을 받는 중(새로 받기 · 다시 받기)이면 그 화면 그대로 둔다. 판은 그동안에도 진행된다
    if (state.isHost && !$('step-host').hidden) { if (!playing) renderLobby(); return; }
    if ($('step-play').hidden && playing) show('step-play');
    if (!$('step-play').hidden) renderPlay();
  };
  net.onError = function (msg) { ConnLog.add('알림', msg); notice(msg); };
  net.onInfo = function (msg) { ConnLog.add('알림', msg); notice(msg, 'ok'); };
  return net;
}

function startHost() {
  state.isHost = true;
  if (!state.net) { makeNet(true); ConnLog.add('나', '방 만들기 · 이름 ' + (state.net.myName || '(없음)')); }
  state.inviteSeat = null;
  show('step-host');
  notice(null);
  renderLobby();
  if (state.net.gatheredCount < 2 && !state.invite) newInvite();
}

// 방장: 끊긴 자리를 다시 받는다. 받는 동안 판은 그대로 두고, 연결되면 판 화면으로 돌아간다
function startReadmit(seat) {
  const net = state.net;
  if (!net || !net.left[seat]) return;
  state.inviteSeat = seat;
  show('step-host');
  notice(null);
  ConnLog.add('나', net.names[seat] + ' 다시 받기 시작');
  newInvite();
}

function cancelInvite() {
  if (state.invite) state.invite.close('받기를 그만뒀어요.');
  state.invite = null;
  const back = state.inviteSeat != null;
  state.inviteSeat = null;
  if (back) { show('step-play'); renderPlay(); } else renderLobby();
}

// 다음 참가자를 받을 연결을 만든다(이전에 받던 연결이 안 열렸으면 닫는다)
async function newInvite() {
  const net = state.net;
  const seat = state.inviteSeat;
  if (seat == null && net.gatheredCount >= MAX_PLAYERS) return;
  if (state.invite) state.invite.close('새 QR로 바꿨어요.');
  const no = net.gatheredCount; // 이번에 받는 참가자 번호(1부터)
  const label = seat != null ? net.names[seat] : '참가자 ' + no;
  const link = new PeerLink(label);
  state.invite = link;
  $('invite-title').textContent = label + (seat != null ? ' 다시 받기' : ' 받기');
  $('readmit-tip').hidden = seat == null;
  $('btn-invite-cancel').hidden = seat == null;
  $('host-lobby').hidden = seat != null;
  $('host-invite').hidden = false;
  $('host-qr').innerHTML = '<p class="muted">연결 코드를 만드는 중…</p>';
  $('host-code').value = '';
  $('host-answer').value = '';
  $('btn-host-scan').disabled = true;
  link.on('open', function () {
    if (state.invite !== link) return;
    state.invite = null;
    if (seat != null) {
      state.inviteSeat = null;
      $('host-lobby').hidden = false;
      if (net.readmit(link, seat)) {
        ConnLog.add('나', label + ' 다시 들어옴');
        notice(label + '이(가) 다시 들어왔어요. 판을 이어서 둬요.', 'ok');
      } else {
        link.close('다시 받을 자리가 없어요.');
        notice('그 사이 판이 바뀌어 다시 받을 수 없어요.');
      }
      show('step-play');
      renderPlay();
      return;
    }
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
  const names = net.lobbyNamesNow();
  let html = '<div class="seat"><span class="nm">' + esc(names[0]) + ' (나 · 방장)</span><span class="st">준비됨</span></div>';
  net.connectedPeers.forEach(function (p, i) {
    html += '<div class="seat"><span class="nm">' + esc(names[i + 1]) + '</span><span class="st">연결됨</span></div>';
  });
  if (state.invite && state.inviteSeat == null) html += '<div class="seat wait"><span class="nm">참가자 ' + n + '</span><span class="st">QR로 받는 중…</span></div>';
  $('lobby-list').innerHTML = html;
  $('host-invite').hidden = !state.invite;
  $('host-lobby').hidden = state.inviteSeat != null;
  $('btn-invite').hidden = !!state.invite || n >= MAX_PLAYERS;
  document.querySelectorAll('#nights-seg [data-nights]').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.nights) === net.nights); });
  $('btn-start').disabled = n < 2;
  $('btn-start').textContent = n < 2 ? '참가자가 오면 시작할 수 있어요' : n + '명으로 시작하기';
}

function hostStart() {
  const net = state.net;
  if (!net || net.gatheredCount < 2) return;
  if (state.invite) { state.invite.close('시작해서 받기를 그만뒀어요.'); state.invite = null; }
  notice(null);
  show('step-play');
  setStatus();
  ConnLog.add('나', net.gatheredCount + '명으로 시작(' + nightsName(net.nights) + '): ' + net.lobbyNamesNow().join(', '));
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
  if (state.guestLink) state.guestLink.close('새로 참가해서 이전 연결을 닫았어요.');
  const link = new PeerLink('방장');
  state.guestLink = link;
  ConnLog.add('나', '참가하기 · 이름 ' + (myName() || '(없음)'));
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
  const me = net.names && net.mySeat != null ? net.names[net.mySeat] : (net.myName || (net.isHost ? '방장' : '참가자'));
  $('status-text').textContent = off ? '방장과 연결 끊김' : '연결됨 · 나는 ' + me;
}

function nightsName(n) { return n === 21 ? '스무하루 밤' : '여덟 밤'; }

// 밤 표시: 스무하루 밤은 날짜(2월 8일 - 28일), 여덟 밤은 몇째 밤
function nightLabel(round, nights) {
  return nights === 21 ? nightDate(round) + ' 밤 · ' + round + '/21' : round + ' / 8번째 밤';
}

// 모은 조각: 괘 그림 + 개수(태극기는 그리지 않는다)
function piecesHtml(parts, size) {
  return '<span class="pcs">' + PIECE_ORDER.map(function (k) {
    const n = parts[k] || 0;
    return '<span class="pc' + (n ? '' : ' zero') + '" title="' + PIECE_NAME[k] + ' ' + n + '개">' + pieceIcon(k, size, n > 0) + '<b>' + n + '</b></span>';
  }).join('') + '</span>';
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
    body.innerHTML = (net && net.hostGone ? guestLostHtml() :
      '<div class="turn wait">방장이 <b>시작하기</b>를 누르기를 기다리는 중… · 지금 ' + count + '명 모였어요(최대 ' + MAX_PLAYERS + '명) · 게임 길이 ' + nightsName(net ? net.nights : 8) + '</div>' +
      (net && net.lobbyNames.length ? '<div class="lobby-list">' + net.lobbyNames.map(function (nm) { return '<div class="seat"><span class="nm">' + esc(nm) + '</span></div>'; }).join('') + '</div>' : ''));
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
  $('night').textContent = g.done ? '끝' : nightLabel(g.round, net.nights);

  // 차례 안내
  let turn, phaseText = '';
  if (g.done) {
    const st = game.standings();
    turn = '<b>' + (net.nights === 21 ? '스물한 밤이 지나 3월 1일 아침이 밝았어요.' : '여덟 밤이 지났어요.') + '</b> ' + esc(st[0].name) + ' 승리!' +
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
    turn = esc(g.players[cur].name) + '의 연결이 끊겨 판이 멈췄어요.' + (net.isHost ? ' 아래 [다시 받기]로 돌아오게 하거나 남은 사람끼리 새 판을 시작할 수 있어요.' : ' 방장이 다시 받거나 새 판을 시작할 때까지 기다려 주세요.');
  } else {
    turn = esc(g.players[cur].name) + ' 차례 · 기다리는 중…';
  }

  // 이번 밤 고르는 순서대로 사람 카드(이미 둔 사람은 흐리게)
  const players = g.order.map(function (id, k) {
    const p = g.players[id];
    const cls = 'pl' + (cur === id ? ' cur' : '') + (!g.done && k < g.orderAt ? ' done' : '') + (net.left[id] ? ' gone' : '');
    return '<div class="' + cls + '"><span class="nm">' + esc(p.name) + (id === net.mySeat ? ' (나)' : '') + '</span><span class="sc">' + p.score + '</span></div>';
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
    choices = snap.rewardOptions.map(function (k) { return '<button data-reward="' + k + '">' + pieceIcon(k, 22, true) + PIECE_NAME[k] + ' (' + me.parts[k] + ')</button>'; }).join('');
  } else if (myTurn && g.phase === 'combo_order') {
    choices = snap.comboOrderOptions.map(function (o) { return '<button data-order="' + o.idx + '">' + COMBO_NAME[o.type] + '</button>'; }).join('');
  }

  // 다른 사람들의 판: 둘이면 옆에, 셋 이상이면 내 판 아래에 줄지어
  const otherBoard = function (p, cls) {
    return '<div class="board-col' + (cls ? ' ' + cls : '') + '"><div class="board-label">' + esc(p.name) + ' · ' + p.score + '점</div>' +
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
    (!live ? guestLostHtml() : '') +
    '<div class="turn' + (myTurn ? '' : ' wait') + '">' + turn + '</div>' +
    (!g.done ? readmitHtml() : '') +
    '<div class="players' + (n > 2 ? ' many' : '') + '">' + (g.done ? '' : '<div class="order">이번 밤 고르는 순서 →</div>') + players + '</div>' +
    boards +
    (g.done ? '' : '<div class="pool">' + pool + '</div>') +
    (choices ? '<div class="opts">' + choices + '</div>' : '') +
    (g.done ? resultHtml(game) : '<div class="pieces">내 조각 ' + piecesHtml(me.parts, 24) + '</div>') +
    (canRestart ? '<div class="row"><button class="primary" id="btn-again">' + (net.gatheredCount >= 2 ? net.gatheredCount + '명으로 새 판' : '새 판(사람이 더 필요해요)') + '</button>' +
      '<button id="btn-more">사람 · 길이 바꾸기</button></div>' : '') +
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
    const label = (ranks[seat] && !needs ? ranks[seat] + '위 · ' : '') + esc(name) + (seat === net.mySeat ? ' (나)' : '');
    return '<div class="pl' + (needs ? ' cur' : '') + (net.left[seat] ? ' gone' : '') + '" style="min-height:60px">' +
      '<span class="nm">' + label + '</span>' +
      (face ? '<span class="muted">눈 ' + r.history[seat].join(' → ') + '</span>' + dieIcon(face.color, face.value, 44) : '<span class="muted">' + (needs ? '굴릴 차례' : '') + '</span>') + '</div>';
  }).join('');
  const canRestart = net.isHost && Object.keys(net.left).length > 0;
  $('play-body').innerHTML =
    (!live ? guestLostHtml() : '') +
    '<div class="turn' + (net.myRollNeeded && live ? '' : ' wait') + '">' + turn + '</div>' +
    readmitHtml() +
    '<div class="stack">' + rows + '</div>' +
    (net.myRollNeeded && live ? '<button class="primary" id="btn-roll">' + (r.history[net.mySeat].length ? '다시 굴리기' : '주사위 굴리기') + '</button>' : '') +
    (canRestart ? '<button id="btn-again">' + (net.gatheredCount >= 2 ? '남은 ' + net.gatheredCount + '명으로 다시 시작' : '새 판(사람이 더 필요해요)') + '</button>' : '');
}

// 끝: 순위 · 점수 · 완성한 태극기 장수
function resultHtml(game) {
  const st = game.standings();
  return '<table class="result"><tr><th></th><th>이름</th><th>점수</th><th>태극기</th></tr>' +
    st.map(function (p, i) {
      return '<tr class="' + (i === 0 ? 'win' : '') + '"><td class="rk">' + (i + 1) + '위</td>' +
        '<td>' + esc(p.name) + (p.id === state.net.mySeat ? ' (나)' : '') + '</td>' +
        '<td class="n">' + p.score + '점</td><td class="n">' + p.flags + '장</td></tr>';
    }).join('') + '</table>' +
    '<p class="muted" style="text-align:center">점수 = 조각 수 + 완성한 태극기 장수 + 쫓아낸 밀정 수</p>';
}

// 방장: 끊긴 자리마다 [다시 받기]
function readmitHtml() {
  const net = state.net;
  if (!net.isHost || !net.names) return '';
  const seats = Object.keys(net.left).map(Number).filter(function (s) { return net.left[s]; });
  if (!seats.length) return '';
  return '<div class="readmit">' + seats.map(function (s) { return '<button data-readmit="' + s + '">' + esc(net.names[s]) + ' 다시 받기</button>'; }).join('') + '</div>';
}

// 참가자: 방장과 끊겼을 때 다시 들어오는 방법(판 진행 중 · 모이는 중 · 판이 끝남)
function guestLostHtml() {
  const net = state.net;
  const inGame = net && (net.rolling || (net.game && !net.g.done));
  let msg;
  if (inGame) {
    const me = net.names && net.mySeat != null ? net.names[net.mySeat] : '내 자리';
    msg = '방장과 연결이 끊겼어요. 방장 화면이 켜져 있다면 방장에게 <b>[' + esc(me) + ' 다시 받기]</b>를 눌러 달라고 한 뒤, 아래 버튼으로 다시 들어오세요. 같은 자리 · 같은 판으로 돌아와요. (방장 화면이 닫혔다면 판은 이어갈 수 없어요.)';
  } else if (net && net.game) {
    msg = '방장과 연결이 끊겼어요. 판은 끝났으니, 다시 하려면 방장이 <b>사람 더 받기</b>를 누른 뒤 아래 버튼으로 다시 들어오세요.';
  } else {
    msg = '방장과 연결이 끊겼어요. 방장에게 <b>한 명 더 받기</b>를 눌러 달라고 한 뒤, 아래 버튼으로 다시 들어오세요.';
  }
  return '<div class="notice err">' + msg + '</div><button class="primary" id="btn-rejoin">다시 들어가기</button>';
}

// ---- 화면 켜짐 유지 ----
// 판 도중 화면이 꺼지면 휴대폰이 Wi-Fi나 앱을 재우면서 연결이 끊기기 쉽다
async function keepAwake() {
  if (!('wakeLock' in navigator) || state.wakeLock || document.hidden) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    ConnLog.add('나', '화면 켜짐 유지 시작');
    state.wakeLock.addEventListener('release', function () { ConnLog.add('나', '화면 켜짐 유지 풀림'); state.wakeLock = null; });
  } catch (e) {
    ConnLog.add('나', '화면 켜짐 유지 못 함: ' + (e && e.message));
  }
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
  // 모이기 화면으로: 사람을 더 받거나(한 명 더 받기) 게임 길이를 바꾼 뒤 시작
  if (e.target.closest('#btn-more')) { startHost(); return; }
  const rd = e.target.closest('[data-readmit]');
  if (rd) { startReadmit(Number(rd.dataset.readmit)); return; }
  if (e.target.closest('#btn-rejoin')) { startGuest(); return; }
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
  $('btn-invite-cancel').addEventListener('click', cancelInvite);
  // 게임 중 [규칙]: 모둠(조합) 규칙과 점수 규칙 팝업
  $('btn-rules').addEventListener('click', function () {
    Sound.play('tap');
    ensureQuickRulesStyle();
    $('rules-body').innerHTML = quickRulesHtml();
    $('rules-modal').hidden = false;
    // 닫기 버튼에 초점을 주되, 긴 내용이 아래로 밀려 내려가지 않게(맨 위부터 보이게)
    $('btn-rules-close').focus({ preventScroll: true });
    document.querySelector('#rules-modal .modal-card').scrollTop = 0;
  });
  $('btn-rules-close').addEventListener('click', function () { $('rules-modal').hidden = true; });
  $('rules-modal').addEventListener('click', function (e) { if (e.target.id === 'rules-modal') $('rules-modal').hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('rules-modal').hidden = true; });
  $('nights-seg').addEventListener('click', function (e) {
    const b = e.target.closest('[data-nights]');
    if (!b || !state.net) return;
    const n = Number(b.dataset.nights);
    try { localStorage.setItem(NIGHTS_KEY, String(n)); } catch (err) { /* 무시 */ }
    Sound.play('tap');
    state.net.setNights(n);
    renderLobby();
  });
  $('btn-log-copy').addEventListener('click', function () { $('log-text').value = ConnLog.text(); copyText('log-text'); });
  $('btn-log-clear').addEventListener('click', function () { if (confirm('연결 기록을 지울까요?')) ConnLog.clear(); });
  $('log-panel').addEventListener('toggle', renderLog);
  ConnLog.onChange(renderLog);
  try { $('my-name').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* 무시 */ }
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
    if (e.target.closest('#step-home button, #step-host button, #step-guest button, #btn-camera-cancel, #btn-roll, #btn-again, #btn-more, [data-readmit], #btn-rejoin')) Sound.play('tap');
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
document.addEventListener('visibilitychange', function () {
  Sound.setHidden(document.hidden);
  // 끊긴 까닭을 찾는 데 가장 중요한 단서: 화면이 꺼지거나 다른 앱으로 가면 휴대폰이 연결을 재울 수 있다
  ConnLog.add('나', document.hidden ? '화면이 가려짐(화면 꺼짐 · 다른 앱 · 홈 화면)' : '화면이 다시 보임');
  if (!document.hidden && $('step-home').hidden) keepAwake();
});
window.addEventListener('online', function () { ConnLog.add('나', '네트워크 연결됨(online)'); });
window.addEventListener('offline', function () { ConnLog.add('나', '네트워크 끊김(offline) — 인터넷이 끊긴 것일 수도, Wi-Fi가 끊긴 것일 수도 있어요'); });
const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
if (conn && conn.addEventListener) conn.addEventListener('change', function () { ConnLog.add('나', '네트워크 바뀜: ' + (conn.type || '?') + ' · ' + (conn.effectiveType || '?')); });
// 화면을 닫거나 다른 곳으로 가면 연결을 바로 닫아, 남은 사람들이 곧바로 알 수 있게 한다
// (그냥 사라지면 WebRTC가 알아차리는 데 30초쯤 걸린다)
window.addEventListener('pagehide', function () {
  ConnLog.add('나', '화면을 닫음(pagehide)');
  if (state.invite) state.invite.close('화면을 닫았어요.');
  if (state.guestLink) state.guestLink.close('화면을 닫았어요.');
  if (state.net) state.net.peers.forEach(function (p) { p.link.close('화면을 닫았어요.'); });
});
ConnLog.add('나', '화면 열림 · ' + deviceSummary());
renderLog();
