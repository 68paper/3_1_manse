#!/usr/bin/env node
/*
 * tools/simulate-crackdown.mjs
 * ------------------------------------------------------------------
 * 「단속의 밤」을 단순 AI로 여러 판 돌려 설정값(js/crackdown.js의 CRACKDOWN_CONFIG)을 가늠한다.
 * 브라우저와 같은 규칙 모듈(CrackdownGame)을 그대로 불러 쓴다.
 *
 * 단순 AI 정책
 *   놓기: 손의 주사위 × 놓을 수 있는 칸 중에서
 *         (1) 모둠으로 얻는 장 수가 큰 수 → (2) 이번 낮 단속 표시 칸을 채우는 수 →
 *         (3) 흩어짐을 만들지 않는 수 → (밀정이 아닌 주사위 → 엔진 AI의 판 모양 점수 → 무작위)
 *   남길 주사위: 단속 표시 칸에 있는 것 → 수직 줄이 가득 차지 않은 것 → 무작위
 *   쫓아낼 밀정: 단속 표시 칸이 아닌 곳의 밀정(표시 칸의 밀정은 그 칸을 지켜 주므로)
 *   교차 완성 순서: 첫 번째 / 놓을 곳이 없을 때: 밀정을 먼저 돌려보냄
 *
 * 실행: node tools/simulate-crackdown.mjs [판수] [옵션]
 *   --start-flags=3      시작 장수(START_FLAGS)
 *   --stars=1,6,10       별 기준(STARS)
 *   --self-spy=1|0       손에서 놓은 밀정도 압수할지(SELF_SPY_SEIZES)
 *   --early=3 --late=3 --final=1   초반(밀정 1칸) · 후반(2칸) · 마지막(3칸) 낮 수
 *   --seed=1             첫 판 시드(판마다 1씩 늘림)
 *   --trace              첫 판 하나의 진행을 밤 · 낮별로 출력(시드 고정 재현용)
 * 외부 패키지 없음. Node 18+ 필요.
 */
import { Engine } from '../js/engine.js';
import { CrackdownGame, CRACKDOWN_CONFIG, makeCrackdownLevel, nightOrdinal } from '../js/crackdown.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'crackdown.json'), 'utf-8'));

/* ---------- 명령줄 ---------- */
const args = process.argv.slice(2);
const opt = {};
let trials = 1000;
args.forEach(function (a) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) opt[m[1]] = m[2] == null ? true : m[2];
  else if (/^\d+$/.test(a)) trials = parseInt(a, 10);
});
const config = {};
if (opt['start-flags'] != null) config.START_FLAGS = parseInt(opt['start-flags'], 10);
if (opt.stars != null) config.STARS = String(opt.stars).split(',').map(Number);
if (opt['self-spy'] != null) config.SELF_SPY_SEIZES = !/^(0|false|no)$/i.test(String(opt['self-spy']));
if (opt.early != null) config.EARLY_CARDS = parseInt(opt.early, 10);
if (opt.late != null) config.LATE_CARDS = parseInt(opt.late, 10);
if (opt.final != null) config.FINAL_CARDS = parseInt(opt.final, 10);
const baseSeed = opt.seed != null ? parseInt(opt.seed, 10) : 1;
const cfg = Object.assign({}, CRACKDOWN_CONFIG, config);

/* ---------- 단순 AI ---------- */
function pickRandom(list, rng) { return list[Math.floor(rng() * list.length)]; }
function bestBy(items, keyOf, rng) {
  let best = [], bestKey = null;
  items.forEach(function (it) {
    const k = keyOf(it);
    const cmp = bestKey == null ? 1 : compareKeys(k, bestKey);
    if (cmp > 0) { best = [it]; bestKey = k; } else if (cmp === 0) best.push(it);
  });
  return pickRandom(best, rng);
}
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
function markedCells(game) { const c = game.card; return c ? c.cells : []; }

function flagsIfPlaced(board, cell, die) {
  const old = board[cell]; board[cell] = die;
  let flags = 0;
  Engine.linesAt(cell).forEach(function (line) {
    if (!Engine.isFull(board, line)) return;
    const t = Engine.comboType(board, line);
    if (t) flags += cfg.FLAGS_PER_COMBO[t];
  });
  board[cell] = old;
  return flags;
}

function choosePlacement(game, rng) {
  const g = game.g, board = game.board, marks = markedCells(game);
  const heur = {};
  Engine.analyzeMoves(g, board, g.pool).moves.forEach(function (m) { heur[m.pi + ':' + m.cell] = m.tier * 1000 + m.value; });
  const cells = game.validCells();
  const moves = [];
  g.pool.forEach(function (die, pi) { cells.forEach(function (cell) { moves.push({ pi: pi, cell: cell, die: die }); }); });
  return bestBy(moves, function (m) {
    return [
      flagsIfPlaced(board, m.cell, m.die),
      marks.indexOf(m.cell) >= 0 ? 1 : 0,
      Engine.wouldScatter(board, m.cell, m.die) ? 0 : 1,
      m.die.value === 1 ? 0 : 1,
      heur[m.pi + ':' + m.cell] || 0
    ];
  }, rng);
}

function chooseKeep(game, rng) {
  const board = game.board, marks = markedCells(game), line = game.g.pending.combo.line;
  return bestBy(line, function (cell) {
    const ls = Engine.linesAt(cell);
    const perp = ls[0] === line ? ls[1] : ls[0];
    const perpFull = perp.every(function (i) { return i === cell || board[i]; });
    return [marks.indexOf(cell) >= 0 ? 1 : 0, perpFull ? 0 : 1];
  }, rng);
}

function chooseEye(game, options, rng) {
  const marks = markedCells(game);
  return bestBy(options, function (cell) { return [marks.indexOf(cell) >= 0 ? 0 : 1]; }, rng);
}

/* ---------- 한 판 ---------- */
const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };
function boardText(board) {
  let s = '';
  for (let r = 0; r < 3; r++) {
    s += '      ' + board.slice(r * 3, r * 3 + 3).map(function (d) { return d ? (d.color[0] + (d.value === 1 ? '◉' : d.value)) : ' .'; }).join(' ') + '\n';
  }
  return s;
}

function playOne(seed, trace) {
  const rng = Engine.mulberry32((seed * 2654435761) >>> 0);
  const game = new CrackdownGame(makeCrackdownLevel(seed), CARDS, config);
  const log = trace ? function (s) { console.log(s); } : function () {};
  let lastNight = 0;
  let guard = 100000;
  while (!game.done && guard-- > 0) {
    if (trace && game.night !== lastNight) {
      lastNight = game.night;
      const c = game.card;
      log('\n== ' + nightOrdinal(game.night) + ' 밤 · 숨긴 ' + game.hidden + '장 · 단속 예고: ' +
        (c ? c.name + ' [' + c.cells.map(function (i) { return i + 1; }).join(',') + ']' : '없음(3월 1일)'));
    }
    const ph = game.phase;
    if (ph === 'day') {
      if (game.dayPending) {
        const r = game.dayStep();
        log('   낮 ' + (r.cell + 1) + '번 칸: ' + (r.kind === 'guarded' ? '지켜 냄' : r.kind === 'skip' ? '건너뜀' :
          '밀정 들어옴(-' + r.seized + ')' + (r.scattered.length ? ' 흩어짐 ' + r.scattered.length : '') + (r.withdrawn.length ? ' 감시 철수' : '')));
      } else {
        log(boardText(game.board).trimEnd());
        game.endDay();
      }
    } else if (ph === 'place') {
      const m = choosePlacement(game, rng);
      const die = game.pool[m.pi], hand = game.hand;
      game.selectDie(m.pi);
      if (!game.placeAt(m.cell)) throw new Error('놓기 실패 seed=' + seed);
      log('   손 ' + hand + ': ' + die.color[0] + (die.value === 1 ? '◉' : die.value) + ' → ' + (m.cell + 1));
    } else if (ph === 'combo_order') {
      game.chooseComboOrder(0);
    } else if (ph === 'combo_keep') {
      game.chooseKeep(chooseKeep(game, rng));
    } else if (ph === 'combo_eye') {
      game.chooseEye(chooseEye(game, game.g.pending.eyeOptions, rng));
    } else if (ph === 'blocked_pool') {
      const i1 = game.pool.findIndex(function (d) { return d.value === 1; });
      game.resolveBlockedPool(i1 >= 0 ? i1 : 0);
    } else if (ph === 'blocked_eye') {
      game.removeBlockedEye(chooseEye(game, game.g.pending.eyeOptions, rng));
    } else {
      throw new Error('알 수 없는 단계 ' + ph + ' seed=' + seed);
    }
    if (trace) game.events.forEach(function (e) {
      if (e.type === 'gain') log('     +' + e.flags + '장 (' + COMBO_NAME[e.combo] + ')');
      if (e.type === 'seize' && e.reason === 'self') log('     -' + e.flags + '장 (손에서 밀정)');
    });
    game.events.length = 0;
  }
  if (!game.done) throw new Error('끝나지 않음 seed=' + seed);
  if (trace) log('\n결과: ' + game.endMessage() + ' · 손에 든 ' + game.hidden + '장 · 빼앗긴 ' + game.seized + ' · 만든 ' + game.made + ' · 별 ' + game.starsEarned());
  const st = game.player.stats;
  return {
    failed: game.failed, failedAt: game.failedAt, hidden: game.hidden, seized: game.seized, made: game.made,
    stars: game.starsEarned(), daySpies: game.daySpies, guarded: game.guarded,
    cross: st.cross, same: st.same, scatter: st.scatterLines, withdrawn: st.withdrawn, blocked: st.blocked
  };
}

/* ---------- 실행 · 보고 ---------- */
if (opt.trace) {
  playOne(baseSeed, true);
  process.exit(0);
}

const results = [];
for (let i = 0; i < trials; i++) results.push(playOne(baseSeed + i, false));

const pct = function (n, d) { return d ? (100 * n / d).toFixed(1) + '%' : '-'; };
const mean = function (arr, f) { return arr.length ? (arr.reduce(function (s, r) { return s + f(r); }, 0) / arr.length).toFixed(2) : '-'; };
const fails = results.filter(function (r) { return r.failed; });
const wins = results.filter(function (r) { return !r.failed; });

console.log('단속의 밤 시뮬레이션 · ' + trials + '판 (시드 ' + baseSeed + '~' + (baseSeed + trials - 1) + ')');
console.log('설정: START_FLAGS=' + cfg.START_FLAGS + ' STARS=' + cfg.STARS.join(',') + ' SELF_SPY_SEIZES=' + cfg.SELF_SPY_SEIZES +
  ' 낮 단속 초반 ' + cfg.EARLY_CARDS + ' · 후반 ' + cfg.LATE_CARDS + ' · 마지막 ' + cfg.FINAL_CARDS);
console.log('');
console.log('실패율            ' + pct(fails.length, trials) + ' (' + fails.length + '판)');
if (fails.length) {
  console.log('실패한 때');
  for (let n = 1; n <= cfg.NIGHTS; n++) {
    const night = fails.filter(function (r) { return r.failedAt.night === n && r.failedAt.when === 'night'; }).length;
    const day = fails.filter(function (r) { return r.failedAt.night === n && r.failedAt.when === 'day'; }).length;
    if (night || day) console.log('  ' + nightOrdinal(n) + ' 밤  밤 ' + String(night).padStart(4) + ' · 낮 ' + String(day).padStart(4));
  }
}
console.log('');
console.log('끝난 판(성공 ' + wins.length + '판) 손에 든 장 수 평균  ' + mean(wins, function (r) { return r.hidden; }));
if (wins.length) {
  const hist = {};
  wins.forEach(function (r) { hist[r.hidden] = (hist[r.hidden] || 0) + 1; });
  const max = Math.max.apply(null, Object.keys(hist).map(Number));
  console.log('손에 든 장 수 분포');
  for (let k = 1; k <= max; k++) {
    const n = hist[k] || 0;
    console.log('  ' + String(k).padStart(2) + '장 ' + String(n).padStart(5) + ' ' + pct(n, wins.length).padStart(6) + ' ' + '#'.repeat(Math.round(60 * n / wins.length)));
  }
}
console.log('');
console.log('빼앗긴 장 수 평균  ' + mean(results, function (r) { return r.seized; }) + ' (전체 판)');
console.log('만든 장 수 평균    ' + mean(results, function (r) { return r.made; }) + ' (전체 판)');
console.log('낮 밀정 평균       ' + mean(results, function (r) { return r.daySpies; }) + ' · 지켜 낸 칸 평균 ' + mean(results, function (r) { return r.guarded; }));
console.log('');
[1, 2, 3].forEach(function (s) {
  const n = results.filter(function (r) { return r.stars >= s; }).length;
  console.log('별 ' + s + ' 이상      ' + pct(n, trials) + ' (전체 판 기준)');
});
[0, 1, 2, 3].forEach(function (s) {
  const n = results.filter(function (r) { return r.stars === s; }).length;
  console.log('  별 정확히 ' + s + '   ' + pct(n, trials));
});
console.log('');
console.log('참고: 판당 교차 완성 ' + mean(results, function (r) { return r.cross; }) + ' · 한뜻 ' + mean(results, function (r) { return r.same; }) +
  ' · 흩어짐 ' + mean(results, function (r) { return r.scatter; }) + ' · 감시 철수 ' + mean(results, function (r) { return r.withdrawn; }) +
  ' · 놓을 곳 없음 ' + mean(results, function (r) { return r.blocked; }));
