/*
 * 『3·1 만세 전야』 판정 엔진 — v0.9.9 웹 테스트판에서 그대로 옮김
 * ------------------------------------------------------------------
 * 이 파일의 조합 판정(comboType) · 흩어짐/감시 철수(finalizePlacement) ·
 * 모둠 처리(beginCombo/afterKeep/beginRewards/chooseReward) · 점수 계산(scoreOf) ·
 * 배치 가능 칸(validCells) 로직은 원본 v0.9.9와 한 글자도 다르지 않다.
 *
 * 딱 한 곳, startRound()만 확장했다: 원래 "8밤 고정 · 인원×2+2개 풀 · 균등 1~6"을
 * "설정 가능한 밤 수 · 광장 크기 · 밀정 확률 · 고정 풀(튜토리얼)"로 바꿨다.
 * 이유와 범위는 함수 위 주석에 적어 두었다.
 *
 * 규칙 추가(룰북 v1.1 「밀정을 쫓아냄」): 한뜻 모둠으로 판의 밀정(1)을
 * 쫓아내면 1점. 그래서 scoreOf()에 p.pushed(쫓아낸 1의 수)를 더하고, chooseComboEye()에서 센다.
 * 감시 철수 · 배치 불가로 빠진 1에는 점수가 없다. 그 외에는 아무것도 바꾸지 않았다.
 *
 * 원본: 3_1_만세_전야_웹_테스트판_v0_9_9.html의 첫 번째 <script> (TG_ENGINE)
 * 기준 룰북: docs/3·1 만세 전야 룰북_v1_1.md
 */

'use strict';

  var COLORS = ['black', 'white', 'red', 'blue'];
  var ROWS = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
  var COLS = [[0, 3, 6], [1, 4, 7], [2, 5, 8]];
  var PIECE_KEYS = ['taegeuk', 'geon', 'ri', 'gam', 'gon'];
  var VALUE_TO_PIECE = { 2: 'taegeuk', 3: 'geon', 4: 'ri', 5: 'gam', 6: 'gon' };
  var TIEBREAK = { same: 0.03, consec: 0.02, color: 0.01 };
  var CONSEC_SETS = [[2, 3, 4], [3, 4, 5], [4, 5, 6]].map(function (a) { return a.join(','); });

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function linesAt(cell) {
    var r = Math.floor(cell / 3), c = cell % 3;
    return [ROWS[r], COLS[c]];
  }
  function pieceIdForValue(v) { return VALUE_TO_PIECE[v] || null; }
  function rewardCount(type) {
    if (type === 'same') return 2;
    if (type === 'consec') return 2;
    if (type === 'color') return 1;
    return 0;
  }
  function comboType(board, line) {
    var d0 = board[line[0]], d1 = board[line[1]], d2 = board[line[2]];
    if (!d0 || !d1 || !d2) return null;
    if (d0.value === 1 || d1.value === 1 || d2.value === 1) return null;
    var vals = [d0.value, d1.value, d2.value];
    var cols = [d0.color, d1.color, d2.color];
    var uv = Array.from(new Set(vals));
    var uc = Array.from(new Set(cols));
    if (uv.length === 1 && uc.length === 3) return 'same';
    if (uc.length === 1 && uv.length === 3) {
      var s = vals.slice().sort(function (a, b) { return a - b; });
      var key = s.join(',');
      if (CONSEC_SETS.indexOf(key) >= 0) return 'consec';
      return 'color';
    }
    return null;
  }
  function isFull(board, line) {
    return board[line[0]] != null && board[line[1]] != null && board[line[2]] != null;
  }
  function hasNonEye(board, line) {
    return line.some(function (i) { return board[i] && board[i].value !== 1; });
  }
  function validCells(board) {
    // 룰북 v0.9.5: 밀정(1)도 배치 기준이 된다.
    // 판이 비어 있으면 아무 칸, 그 외에는 놓인 주사위(1 포함)의 상하좌우 빈칸.
    var empty = [], occupied = [];
    for (var i = 0; i < 9; i++) {
      if (!board[i]) empty.push(i); else occupied.push(i);
    }
    if (empty.length === 9) return empty;
    var adj = function (i) {
      var r = Math.floor(i / 3), c = i % 3, out = [];
      if (r > 0) out.push(i - 3);
      if (r < 2) out.push(i + 3);
      if (c > 0) out.push(i - 1);
      if (c < 2) out.push(i + 1);
      return out;
    };
    var anchorSet = {};
    occupied.forEach(function (a) { adj(a).forEach(function (n) { anchorSet[n] = true; }); });
    return empty.filter(function (i) { return anchorSet[i]; });
  }

  function makePlayer(id, type, name) {
    return {
      id: id, name: name, type: type,
      board: new Array(9).fill(null),
      parts: { taegeuk: 0, geon: 0, ri: 0, gam: 0, gon: 0 },
      score: 0, arrival: 0, firstFlagRound: null, scoreHistory: [0],
      pushed: 0, // 한뜻으로 쫓아낸 밀정 수(1개당 1점)
      stats: {
        same: 0, consec: 0, color: 0, cross: 0,
        scatterLines: 0, scatterDice: 0, blocked: 0, withdrawn: 0,
        eyesTaken: 0, eyesRemoved: 0, forcedScatter: 0,
        sourceSame: 0, sourceConsec: 0, sourceColor: 0, placements: 0
      }
    };
  }
  function flagsOf(p) { return Math.min(p.parts.taegeuk, p.parts.geon, p.parts.ri, p.parts.gam, p.parts.gon); }
  function pieceTotal(p) { return p.parts.taegeuk + p.parts.geon + p.parts.ri + p.parts.gam + p.parts.gon; }
  // 점수 = 조각 + 태극기 완성 장수 + 한뜻으로 쫓아낸 밀정 수(룰북 v1.1)
  function scoreOf(p) { return pieceTotal(p) + flagsOf(p) + (p.pushed || 0); }

  function newBag() { var b = {}; COLORS.forEach(function (c) { b[c] = 16; }); return b; }
  function bagTotal(bag) { return COLORS.reduce(function (s, c) { return s + bag[c]; }, 0); }
  function drawFromBag(bag, n, rng) {
    var take = Math.min(n, bagTotal(bag));
    var shortage = take < n;
    var colors = [];
    for (var k = 0; k < take; k++) {
      var tot = bagTotal(bag);
      var r = rng() * tot;
      var cum = 0, chosen = COLORS[COLORS.length - 1];
      for (var ci = 0; ci < COLORS.length; ci++) {
        cum += bag[COLORS[ci]];
        if (r < cum) { chosen = COLORS[ci]; break; }
      }
      bag[chosen]--; colors.push(chosen);
    }
    return { colors: colors, shortage: shortage };
  }

  function create(settings) {
    var rng = mulberry32(settings.seed);
    var n = settings.n;
    var players = [];
    for (var i = 0; i < n; i++) {
      players.push(makePlayer(i, settings.types[i], settings.types[i] === 'human' ? ('플레이어 ' + (i + 1)) : ('AI-' + (i + 1))));
    }
    return {
      settings: settings, rng: rng,
      bag: newBag(), pool: [], order: [], orderAt: 0,
      round: 0, placementsThisTurn: 0,
      players: players, arrivalCounter: 0,
      events: [], eventId: 0,
      phase: 'idle', pending: null,
      r4Snapshot: null, leaderHistory: [], done: false
    };
  }

  function emit(g, type, data, summary) {
    var e = { id: ++g.eventId, type: type, round: g.round, player: current(g) ? current(g).name : null, data: data, summary: summary };
    g.events.push(e);
    return e;
  }
  function current(g) { return g.players[g.order[g.orderAt]]; }
  function snapshotBoard(p) { return p.board.map(function (d) { return d ? (d.color[0] + d.value) : '.'; }).join(','); }

  // ---- 1인 모바일 확장 지점 --------------------------------------------
  // 아래부터 startRound() 끝까지는 v0.9.9 원본과 다르다. 바뀐 것은 오직
  // "밤 수 · 광장 크기 · 풀 구성을 어디서 가져오는지"뿐이며, 조합 판정 · 흩어짐 ·
  // 감시 철수 · 점수 계산(모둠 이후의 모든 로직)은 원본 그대로다.
  //   g.settings.maxRounds     : 밤 수. 없으면 8 (원본과 동일)
  //   g.settings.poolSize      : 밤마다 꺼내는 주사위 수. 없으면 n*2+2 (원본과 동일)
  //   g.settings.eyeChance     : 밀정(1) 확률. null/미지정이면 균등 1/6 (원본과 동일)
  //   g.settings.scriptedPools : [[[색,눈], ...], ...] 밤별 고정 풀. 있으면 그 밤은
  //                              주머니 대신 이 배열을 그대로 쓴다 (튜토리얼 전용)
  function rollValue(rng, eyeChance) {
    if (eyeChance == null) return 1 + Math.floor(rng() * 6);
    if (rng() < eyeChance) return 1;
    return 2 + Math.floor(rng() * 5);
  }
  function startRound(g) {
    var maxRounds = g.settings.maxRounds || 8;
    if (g.round >= maxRounds) { return endGame(g); }
    g.round++;
    var firstPass = g.players.slice().sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      // 룰북 v0.9.9: 같은 칸에서는 위에 올라선 말(나중 도착)이 앞선다 → 아래 말(먼저 도착)이 먼저 고른다
      if (a.arrival !== b.arrival) return a.arrival - b.arrival;
      return g.rng() - 0.5;
    }).map(function (p) { return p.id; });
    g.order = firstPass;
    g.orderAt = 0;
    var scriptedThisNight = g.settings.scriptedPools && g.settings.scriptedPools[g.round - 1];
    if (scriptedThisNight) {
      // 튜토리얼: 주머니를 건드리지 않고 지정된 풀을 그대로 쓴다
      g.pool = scriptedThisNight.map(function (pair) { return { color: pair[0], value: pair[1] }; });
    } else {
      var need = g.settings.poolSize || (g.settings.n * 2 + 2);
      var drawn = drawFromBag(g.bag, need, g.rng);
      if (drawn.shortage) g._shortage = (g._shortage || 0) + 1;
      g.pool = drawn.colors.map(function (c) { return { color: c, value: rollValue(g.rng, g.settings.eyeChance) }; });
    }
    var poolColorCount = {}; COLORS.forEach(function (c) { poolColorCount[c] = 0; });
    g.pool.forEach(function (d) { poolColorCount[d.color]++; });
    if (COLORS.some(function (c) { return poolColorCount[c] === 0; })) g._zeroColorRounds = (g._zeroColorRounds || 0) + 1;
    emit(g, 'round_start', { order: g.order.slice() },
      'R' + g.round + ' · 순서 ' + g.order.map(function (id) { var p = g.players[id]; return p.name + '(' + p.score + '점)'; }).join(' → '));
    beginTurn(g);
  }

  // 룰북 v0.9.7: 차례마다 두 개 연속으로 고정
  function settingsPickMode(g) { return 'consecutive'; }
  function ruleModeOf(g) { return g.settings.ruleMode === 'advanced' ? 'advanced' : 'basic'; }
  function beginTurn(g) { g.placementsThisTurn = 0; g.phase = 'idle'; prepareStep(g); }

  function prepareStep(g) {
    var p = current(g);
    var cells = validCells(p.board);
    if (cells.length === 0 || g.pool.length === 0) {
      g.phase = 'blocked_pool';
      emit(g, 'blocked', {}, 'R' + g.round + ' · ' + p.name + ' · 배치 '+(g.placementsThisTurn+1)+'/2 불가 · 놓을 곳 없음');
      return;
    }
    g.phase = 'place';
  }

  function analyzeMoves(g, board, pool) {
    var cells = validCells(board);
    var moves = []; var anyFree = false;
    for (var pi = 0; pi < pool.length; pi++) {
      var die = pool[pi];
      for (var ci = 0; ci < cells.length; ci++) {
        var cell = cells[ci];
        var old = board[cell];
        board[cell] = die;
        var lines = linesAt(cell);
        var results = lines.map(function (line) {
          if (!isFull(board, line)) return null;
          return { line: line, type: comboType(board, line) };
        });
        var combos = results.filter(function (r) { return r && r.type; });
        var scatterFlag = results.some(function (r) { return r && !r.type && hasNonEye(board, r.line); });
        var tier, value;
        if (combos.length === 2) {
          tier = 3; value = combos.reduce(function (s, c) { return s + rewardCount(c.type) + TIEBREAK[c.type]; }, 0);
        } else if (combos.length === 1) {
          tier = 2; value = rewardCount(combos[0].type) + TIEBREAK[combos[0].type];
        } else {
          tier = 1; value = buildHeuristic(board, cell, die);
          if (scatterFlag) value -= 30;
        }
        board[cell] = old;
        if (!scatterFlag) anyFree = true;
        moves.push({ pi: pi, cell: cell, tier: tier, value: value, scatterFlag: scatterFlag });
      }
    }
    return { moves: moves, anyFree: anyFree };
  }

  function buildHeuristic(board, cell, die) {
    var lines = linesAt(cell); var score = 0;
    lines.forEach(function (line) {
      var existing = line.filter(function (i) { return i !== cell && board[i]; }).map(function (i) { return board[i]; });
      if (existing.length === 0) return;
      var has1 = existing.some(function (d) { return d.value === 1; });
      if (die.value === 1) {
        if (has1) { score += -2; return; }
        var colorsE = new Set(existing.map(function (d) { return d.color; }));
        var valsE = new Set(existing.map(function (d) { return d.value; }));
        var potential = (valsE.size === 1 ? 1 : 0) + (colorsE.size === 1 ? 1 : 0);
        score += -8 - 4 * potential * existing.length;
        return;
      }
      if (has1) { score += -3; return; }
      var compatSame = existing.every(function (d) { return d.value === die.value; });
      var colorsMatch = existing.every(function (d) { return d.color === die.color; });
      var valsE2 = existing.map(function (d) { return d.value; });
      var trackScore = 0, compatTrack = false;
      if (colorsMatch) {
        var distinct = valsE2.indexOf(die.value) < 0;
        compatTrack = distinct;
        var inWindow = false;
        if (existing.length === 2) {
          var cand = valsE2.concat([die.value]).sort(function (a, b) { return a - b; }).join(',');
          inWindow = CONSEC_SETS.indexOf(cand) >= 0;
        } else if (existing.length === 1) {
          inWindow = CONSEC_SETS.some(function (s) {
            var arr = s.split(',').map(Number);
            return arr.indexOf(die.value) >= 0 && arr.indexOf(valsE2[0]) >= 0;
          });
        }
        trackScore = inWindow ? (3 * existing.length + 1) : (distinct ? 3 * existing.length : 0);
      }
      if (compatSame && compatTrack) score += Math.max(2 * existing.length + 1, trackScore);
      else if (compatSame) score += 2 * existing.length + 1;
      else if (compatTrack) score += trackScore;
      else score += -6;
    });
    return score;
  }

  function wouldScatter(board, cell, die) {
    var old = board[cell]; board[cell] = die;
    var lines = linesAt(cell);
    var yes = lines.some(function (line) { return isFull(board, line) && !comboType(board, line) && hasNonEye(board, line); });
    board[cell] = old;
    return yes;
  }

  function dieLabel(d) {
    var names = { black: '검정', white: '흰색', red: '빨강', blue: '파랑' };
    return names[d.color] + ' ' + (d.value === 1 ? '◉' : d.value);
  }
  var TYPE_NAME = { same: '같은 눈', consec: '연속', color: '같은 색' };
  var PIECE_NAME = { taegeuk: '태극', geon: '건', ri: '리', gam: '감', gon: '곤' };

  function place(g, pi, cell) {
    var p = current(g);
    var valid = validCells(p.board);
    if (valid.indexOf(cell) < 0 || !g.pool[pi]) return false;
    var die = g.pool.splice(pi, 1)[0];
    p.board[cell] = die;
    p.stats.placements++;
    if (die.value === 1) p.stats.eyesTaken++;
    var lines = linesAt(cell);
    var found = lines.map(function (line) {
      if (!isFull(p.board, line)) return null;
      var type = comboType(p.board, line);
      if (!type) return null;
      return { line: line, type: type, values: line.map(function (i) { return p.board[i].value; }) };
    }).filter(Boolean);
    g.pending = { placedCell: cell, combos: found, comboIndex: 0, combo: null, rewardIndex: 0, rewardTotal: 0, scoreBefore: p.score };
    emit(g, 'placement', { die: die, cell: cell },
      'R' + g.round + ' · ' + p.name + ' · ' + dieLabel(die) + ' → (' + (Math.floor(cell / 3) + 1) + ',' + (cell % 3 + 1) + ')');
    if (found.length === 0) return finalizePlacement(g);
    if (found.length === 2) return prepareCross(g);
    beginCombo(g, found[0], false);
    return true;
  }

  function prepareCross(g) {
    var p = current(g);
    var placed = g.pending.placedCell;
    var removedCells = Array.from(new Set(g.pending.combos.reduce(function (a, c) { return a.concat(c.line); }, [])))
      .filter(function (i) { return i !== placed; });
    removedCells.forEach(function (i) { g.bag[p.board[i].color]++; p.board[i] = null; });
    p.stats.cross++;
    emit(g, 'cross', {}, '└ 교차 완성');
    if (p.type === 'human') { g.phase = 'combo_order'; }
    else {
      g.pending.combos.sort(function (a, b) { return rewardCount(b.type) - rewardCount(a.type); });
      beginCombo(g, g.pending.combos[0], true);
    }
  }

  function chooseComboOrder(g, idx) {
    if (g.phase !== 'combo_order') return false;
    var c = g.pending.combos.splice(idx, 1)[0];
    g.pending.combos.unshift(c);
    g.pending.comboIndex = 0;
    beginCombo(g, c, true);
    return true;
  }

  function beginCombo(g, c, skipKeep) {
    var p = current(g);
    g.pending.combo = c;
    g.pending.rewardIndex = 0;
    g.pending.rewardTotal = rewardCount(c.type);
    g.pending.rewardValueOptions = null;
    p.stats[c.type]++;
    if (skipKeep) { afterKeep(g); return; }
    g.phase = 'combo_keep';
  }

  function perpLineOf(cell, line) { var ls = linesAt(cell); return ls[0] === line ? ls[1] : ls[0]; }
  function perpendicularPotential(board, cell, die, excludeLine) {
    var score = 0;
    linesAt(cell).forEach(function (line) {
      if (line === excludeLine) return;
      var others = line.filter(function (i) { return i !== cell && board[i]; }).map(function (i) { return board[i]; });
      if (others.length === 0) return;
      if (others.some(function (d) { return d.value === 1; })) return;
      if (others.every(function (d) { return d.value === die.value; })) score += 2 * others.length;
      var pipsO = {}; others.forEach(function (d) { pipsO[d.value] = true; });
      if (others.every(function (d) { return d.color === die.color; })) { if (!pipsO[die.value]) score += 2 * others.length; }
    });
    return score;
  }
  function aiChooseKeep(g) {
    var p = current(g); var line = g.pending.combo.line;
    var best = [], bestKey = null;
    line.forEach(function (cell) {
      var die = p.board[cell];
      var pl = perpLineOf(cell, line);
      var othersFull = pl.every(function (i) { return i === cell || p.board[i]; });
      var penalty = othersFull ? -100 : 0;
      var key = penalty + perpendicularPotential(p.board, cell, die, line);
      if (bestKey === null || key > bestKey) { bestKey = key; best = [cell]; }
      else if (key === bestKey) best.push(cell);
    });
    // 검증 스크립트용: g.aiRng가 있으면 그것을(별도 난수), 없으면 원본처럼 g.rng를 쓴다
    return best[Math.floor((g.aiRng || g.rng)() * best.length)];
  }

  function chooseKeep(g, cell) {
    if (g.phase !== 'combo_keep') return false;
    var p = current(g); var line = g.pending.combo.line;
    if (line.indexOf(cell) < 0 || !p.board[cell]) return false;
    line.forEach(function (i) { if (i !== cell) { g.bag[p.board[i].color]++; p.board[i] = null; } });
    emit(g, 'keep', { cell: cell }, '└ 남김: ' + dieLabel(p.board[cell]));
    afterKeep(g);
    return true;
  }

  function afterKeep(g) {
    var p = current(g);
    if (g.pending.combo.type === 'same') {
      var eyes = [];
      for (var i = 0; i < 9; i++) if (p.board[i] && p.board[i].value === 1) eyes.push(i);
      if (eyes.length === 0) { beginRewards(g); return; }
      if (eyes.length === 1) { chooseComboEye(g, eyes[0]); return; }
      g.phase = 'combo_eye'; g.pending.eyeOptions = eyes; return;
    }
    beginRewards(g);
  }

  function aiChooseEye(g, eyes) {
    var p = current(g);
    var best = [], bestScore = null;
    eyes.forEach(function (cell) {
      var s = 0;
      linesAt(cell).forEach(function (line) {
        var others = line.filter(function (i) { return i !== cell && p.board[i] && p.board[i].value !== 1; }).map(function (i) { return p.board[i]; });
        if (others.length === 2) {
          var d1 = others[0], d2 = others[1];
          if (d1.value === d2.value || d1.color === d2.color) { s += 2; return; }
        }
        s += others.length;
      });
      if (bestScore === null || s > bestScore) { bestScore = s; best = [cell]; }
      else if (s === bestScore) best.push(cell);
    });
    // 검증 스크립트용: g.aiRng가 있으면 그것을(별도 난수), 없으면 원본처럼 g.rng를 쓴다
    return best[Math.floor((g.aiRng || g.rng)() * best.length)];
  }

  function chooseComboEye(g, cell) {
    var p = current(g);
    if (!p.board[cell] || p.board[cell].value !== 1) return false;
    g.bag[p.board[cell].color]++; p.board[cell] = null;
    p.stats.eyesRemoved++;
    p.pushed = (p.pushed || 0) + 1; // 밀정을 쫓아냄 1점
    emit(g, 'eye_removed', { cell: cell }, '└ 밀정을 쫓아냄 (한뜻) · +1점');
    beginRewards(g);
    return true;
  }

  function beginRewards(g) {
    var c = g.pending.combo;
    if (g.pending.rewardIndex >= g.pending.rewardTotal) { return finishCombo(g); }
    if (c.type !== 'same' && !g.pending.rewardValueOptions) g.pending.rewardValueOptions = Array.from(new Set(c.values));
    var lineOpts = c.type === 'same' ? [] : g.pending.rewardValueOptions.map(pieceIdForValue);
    // 룰북 v0.9.7
    //  기본 규칙: 모든 조합의 보상이 원하는 조각 (같은 눈 2 · 연속 2 · 같은 색 1)
    //  심화 규칙 「괘 맞추기」: 연속은 세 눈 중 1개 + 원하는 조각 1개, 같은 색은 세 눈 중 1개
    var free;
    if (c.type === 'same' || ruleModeOf(g) === 'basic') free = true;
    else if (c.type === 'consec') free = (g.pending.rewardIndex === 1);
    else free = false;
    g.pending.rewardOptions = free ? PIECE_KEYS.slice() : lineOpts;
    g.pending.rewardFree = free;
    if (g.pending.rewardOptions.length === 1 && current(g).type === 'ai') { chooseReward(g, g.pending.rewardOptions[0]); return; }
    g.phase = 'combo_reward';
  }
  function aiChooseReward(g) {
    var p = current(g); var opts = g.pending.rewardOptions;
    var min = Math.min.apply(null, opts.map(function (k) { return p.parts[k]; }));
    var pool = opts.filter(function (k) { return p.parts[k] === min; });
    // 검증 스크립트용: g.aiRng가 있으면 그것을(별도 난수), 없으면 원본처럼 g.rng를 쓴다
    return pool[Math.floor((g.aiRng || g.rng)() * pool.length)];
  }
  function chooseReward(g, key) {
    if (!g.pending || !g.pending.rewardOptions || g.pending.rewardOptions.indexOf(key) < 0) return false;
    var p = current(g); var c = g.pending.combo;
    p.parts[key]++;
    p.stats['source' + (c.type === 'same' ? 'Same' : c.type === 'consec' ? 'Consec' : 'Color')]++;
    g.pending.rewardIndex++;
    emit(g, 'reward', { key: key }, '└ 조각 ' + g.pending.rewardIndex + '/' + g.pending.rewardTotal + ': ' + PIECE_NAME[key]);
    beginRewards(g);
    return true;
  }

  function finishCombo(g) {
    g.pending.comboIndex++;
    if (g.pending.comboIndex < g.pending.combos.length) { beginCombo(g, g.pending.combos[g.pending.comboIndex], true); return; }
    finalizePlacement(g);
  }

  function finalizePlacement(g) {
    var p = current(g); var cell = g.pending.placedCell;
    linesAt(cell).forEach(function (line) {
      if (isFull(p.board, line) && !comboType(p.board, line)) {
        var removed = [];
        line.forEach(function (i) { if (p.board[i] && p.board[i].value !== 1) removed.push(i); });
        if (removed.length > 0) {
          removed.forEach(function (i) { g.bag[p.board[i].color]++; p.board[i] = null; });
          p.stats.scatterLines++; p.stats.scatterDice += removed.length;
          emit(g, 'scatter', { line: line }, '└ 흩어짐 · ' + removed.length + '개 반환');
        }
      }
    });
    // 감시 철수(룰북 v0.9.6): 밀정 셋으로만 채워진 줄은 셋 모두 주머니로
    linesAt(cell).forEach(function (line) {
      if (isFull(p.board, line) && line.every(function (i) { return p.board[i].value === 1; })) {
        line.forEach(function (i) { g.bag[p.board[i].color]++; p.board[i] = null; });
        p.stats.withdrawn++;
        emit(g, 'withdraw', { line: line }, '└ 감시 철수 · 밀정 3개 반환');
      }
    });
    updateScore(g, p);
    g.pending = null; g.placementsThisTurn++;
    advance(g);
  }

  function updateScore(g, p) {
    var before = p.score, beforeFlags = flagsOf(p);
    var after = scoreOf(p), afterFlags = flagsOf(p);
    if (after !== before) {
      g.arrivalCounter++; p.arrival = g.arrivalCounter; p.score = after;
      p.scoreHistory[g.round] = after;
      if (afterFlags > beforeFlags && p.firstFlagRound == null) p.firstFlagRound = g.round;
      emit(g, 'score', { before: before, after: after }, '└ 점수 ' + before + ' → ' + after);
    }
  }

  function resolveBlockedPool(g, pi) {
    var p = current(g);
    var die = g.pool.splice(pi, 1)[0];
    g.bag[die.color]++; p.stats.blocked++;
    emit(g, 'blocked_return', { die: die }, '└ 광장 ' + dieLabel(die) + ' 반환');
    var eyes = [];
    for (var i = 0; i < 9; i++) if (p.board[i] && p.board[i].value === 1) eyes.push(i);
    if (eyes.length === 0) { finishBlocked(g); return; }
    if (eyes.length === 1) { removeBlockedEye(g, eyes[0]); return; }
    g.phase = 'blocked_eye'; g.pending = { eyeOptions: eyes };
  }
  function removeBlockedEye(g, cell) {
    var p = current(g);
    if (!p.board[cell] || p.board[cell].value !== 1) return false;
    g.bag[p.board[cell].color]++; p.board[cell] = null; p.stats.eyesRemoved++;
    emit(g, 'blocked_eye_return', { cell: cell }, '└ 판의 밀정 제거');
    finishBlocked(g); return true;
  }
  function finishBlocked(g) { g.pending = null; g.placementsThisTurn++; advance(g); }

  function advance(g) {
    if (g.placementsThisTurn < 2 && g.pool.length > 0) { prepareStep(g); return; }
    g.orderAt++;
    if (g.orderAt >= g.order.length) { endRound(g); return; }
    beginTurn(g);
  }

  function endRound(g) {
    var returned = g.pool.slice();
    returned.forEach(function (d) { g.bag[d.color]++; });
    g.pool = [];
    var scores = g.players.map(function (p) { return { name: p.name, score: p.score }; });
    var mx = Math.max.apply(null, g.players.map(function (p) { return p.score; }));
    var leaders = g.players.filter(function (p) { return p.score === mx; });
    // 룰북 v0.9.9: 동점이면 위에 올라선 말(나중 도착)이 선두
    leaders.sort(function (a, b) { return b.arrival - a.arrival; });
    g.leaderHistory.push(leaders.length ? leaders[0].id : null);
    if (g.round === 4) g.r4Snapshot = g.players.map(function (p) { return { id: p.id, score: p.score }; });
    emit(g, 'round_end', { scores: scores }, 'R' + g.round + ' 종료');
    startRound(g);
  }

  function endGame(g) {
    g.done = true; g.phase = 'end';
    var mx = Math.max.apply(null, g.players.map(function (p) { return p.score; }));
    var tied = g.players.filter(function (p) { return p.score === mx; });
    // 룰북 v0.9.9: 같은 점수면 나중에 올라선 말(위)이 승리
    tied.sort(function (a, b) { return b.arrival - a.arrival; });
    g.winnerId = tied[0].id; g.rawTie = tied.length > 1;
    var changes = 0, prev = null;
    g.leaderHistory.forEach(function (l) { if (l != null) { if (prev != null && l !== prev) changes++; prev = l; } });
    g.leaderChanges = changes;
    emit(g, 'game_end', {}, '게임 종료 · 승자 ' + g.players[g.winnerId].name);
  }

  function aiAct(g) {
    var p = current(g);
    if (p.type !== 'ai') return false;
    if (g.phase === 'blocked_pool') {
      var idx1 = g.pool.findIndex(function (d) { return d.value === 1; });
      // 검증 스크립트용: g.aiRng가 있으면 그것을(별도 난수), 없으면 원본처럼 g.rng를 쓴다
      var pi = idx1 >= 0 ? idx1 : Math.floor((g.aiRng || g.rng)() * g.pool.length);
      resolveBlockedPool(g, pi);
      if (g.phase === 'blocked_eye') removeBlockedEye(g, aiChooseEye(g, g.pending.eyeOptions));
      return true;
    }
    if (g.phase === 'place') {
      var an = analyzeMoves(g, p.board, g.pool);
      if (an.moves.length && !an.anyFree) p.stats.forcedScatter++;
      var bestList = [an.moves[0]], bestTier = an.moves[0].tier, bestVal = an.moves[0].value;
      an.moves.forEach(function (m) {
        if (m.tier > bestTier || (m.tier === bestTier && m.value > bestVal)) { bestTier = m.tier; bestVal = m.value; bestList = [m]; }
        else if (m.tier === bestTier && m.value === bestVal) bestList.push(m);
      });
      // 검증 스크립트용: g.aiRng가 있으면 그것을(별도 난수), 없으면 원본처럼 g.rng를 쓴다
      var best = bestList[Math.floor((g.aiRng || g.rng)() * bestList.length)];
      place(g, best.pi, best.cell);
      return true;
    }
    if (g.phase === 'combo_order') { chooseComboOrder(g, 0); return true; }
    if (g.phase === 'combo_keep') { chooseKeep(g, aiChooseKeep(g)); return true; }
    if (g.phase === 'combo_eye') { chooseComboEye(g, aiChooseEye(g, g.pending.eyeOptions)); return true; }
    if (g.phase === 'combo_reward') { chooseReward(g, aiChooseReward(g)); return true; }
    if (g.phase === 'blocked_eye') { removeBlockedEye(g, aiChooseEye(g, g.pending.eyeOptions)); return true; }
    return false;
  }

  function runFullAI(g, maxSteps) {
    var steps = maxSteps || 200000;
    while (!g.done && steps-- > 0) {
      if (g.phase === 'idle') { prepareStep(g); continue; }
      if (!aiAct(g)) break;
    }
    return g;
  }
  function startGame(settings) { var g = create(settings); startRound(g); return g; }
  function finalStats(g) {
    return g.players.map(function (p) {
      return { id: p.id, name: p.name, score: p.score, arrival: p.arrival, parts: Object.assign({}, p.parts), pushed: p.pushed || 0,
        pieces: pieceTotal(p), flags: flagsOf(p), firstFlagRound: p.firstFlagRound, stats: Object.assign({}, p.stats) };
    });
  }

  var Engine = {
    COLORS: COLORS, PIECE_KEYS: PIECE_KEYS, TYPE_NAME: TYPE_NAME, PIECE_NAME: PIECE_NAME,
    mulberry32: mulberry32, linesAt: linesAt, validCells: validCells, comboType: comboType,
    wouldScatter: wouldScatter, rewardCount: rewardCount, pieceIdForValue: pieceIdForValue,
    flagsOf: flagsOf, pieceTotal: pieceTotal, scoreOf: scoreOf,
    create: create, startRound: startRound, place: place, chooseComboOrder: chooseComboOrder,
    chooseKeep: chooseKeep, chooseComboEye: chooseComboEye, chooseReward: chooseReward,
    resolveBlockedPool: resolveBlockedPool, removeBlockedEye: removeBlockedEye,
    current: current, analyzeMoves: analyzeMoves, aiAct: aiAct, runFullAI: runFullAI,
    startGame: startGame, finalStats: finalStats, dieLabel: dieLabel, snapshotBoard: snapshotBoard,
    // 1인 모드(solo.js)가 재사용하는 보조 함수 — 기존 함수를 그대로 내보내기만 함 (로직 변경 없음)
    newBag: newBag, bagTotal: bagTotal, drawFromBag: drawFromBag, makePlayer: makePlayer,
    isFull: isFull, hasNonEye: hasNonEye,
    endGame: endGame // 스무하루의 밤: 종료 버튼 · 막힌 판에서 게임을 끝낼 때
  };

export { Engine };
export default Engine;
