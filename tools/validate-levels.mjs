#!/usr/bin/env node
/*
 * tools/validate-levels.mjs
 * ------------------------------------------------------------------
 * data/levels.json의 각 단계를, 같은 엔진으로 "보통 AI"와 "숙련 AI"가 여러 번
 * (시드는 고정, AI의 동점 처리 난수만 바꿔 가며) 플레이해 분포를 낸다.
 *
 *   보통 AI : 엔진에 이미 있는 AI(Engine.runFullAI / aiAct) 그대로.
 *             한 번에 한 배치씩, 그 배치만 보고 가장 좋은 수를 둔다.
 *   숙련 AI : 이 스크립트에서 구현. 밤의 첫 번째 배치를 고를 때,
 *             "그 배치를 처리한 뒤 남는 판 + 풀로 둘 수 있는 두 번째 배치 중
 *             가장 좋은 것"까지 함께 따져서 첫 번째 수를 고른다(2수 앞을 봄).
 *             두 번째 배치는 더 볼 곳이 없으므로 보통 AI와 같은 방식으로 고른다.
 *
 * 실행: node tools/validate-levels.mjs [트라이얼수]
 * 외부 패키지 없음. Node 18+ (ES modules) 필요.
 */
import { Engine } from '../js/engine.js';
import { isBlockedStart, buildSoloSettings, applyStartEyes } from '../js/levelSetup.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRIALS = parseInt(process.argv[2] || '400', 10);

function loadLevels() {
  const p = path.join(__dirname, '..', 'data', 'levels.json');
  const raw = readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

/* ---------- 레벨 하나를 한 판 준비 ---------- */
function freshGame(level, aiSeedCounterRef) {
  const settings = buildSoloSettings(level, 'ai');
  const g = Engine.create(settings);
  // 검증 스크립트의 AI 전용 난수(별도 스트림) — 레벨의 풀 시퀀스(g.rng)와 절대 섞이지 않는다
  aiSeedCounterRef.n = (aiSeedCounterRef.n + 2654435761) >>> 0;
  g.aiRng = Engine.mulberry32(aiSeedCounterRef.n);
  applyStartEyes(Engine, g, level.startEyes);
  Engine.startRound(g);
  return g;
}

/* ---------- 보통 AI: 엔진 기본 AI 그대로 ---------- */
function playAverage(level, aiSeedCounterRef) {
  const g = freshGame(level, aiSeedCounterRef);
  Engine.runFullAI(g, 500000);
  return g;
}

/* ---------- 숙련 AI: 밤의 첫 배치만 2수 앞을 봄 ---------- */
function cloneBoard(board) {
  return board.map(function (d) { return d ? { color: d.color, value: d.value } : null; });
}
function bestMoveValue(moves) {
  // analyzeMoves() 결과에서 가장 좋은 수 하나(동점이면 배열)를 tier*1000+value로 비교
  let best = null, bestScore = -Infinity;
  moves.forEach(function (m) {
    const s = m.tier * 1000 + m.value;
    if (s > bestScore) { bestScore = s; best = [m]; }
    else if (s === bestScore) best.push(m);
  });
  return { best, bestScore };
}
// 후보 (pi,cell) 하나를 실제로 두었을 때, 조합 처리까지 끝난 뒤의 (판,남은풀) 상태를 얻는다.
// 진짜 엔진 함수(place/aiAct)를 던지기 전용 미니 게임에 그대로 태워서 구한다 — 판정 로직은 원본 그대로 쓴다.
function simulateOnePlacement(board, pool, pi, cell, scratchSeed) {
  const settings = { n: 1, types: ['ai'], seed: 1, ruleMode: 'basic', maxRounds: 1, poolSize: pool.length };
  const gc = Engine.create(settings);
  gc.players[0].board = cloneBoard(board);
  gc.pool = pool.map(function (d) { return { color: d.color, value: d.value }; });
  gc.order = [0]; gc.orderAt = 0; gc.phase = 'place'; gc.placementsThisTurn = 0;
  gc.aiRng = Engine.mulberry32(scratchSeed); // 평가용 임시 난수 — 바깥 난수 스트림과 무관
  Engine.place(gc, pi, cell);
  // 조합/흩어짐/감시철수 처리를 끝까지 자동으로 진행시켜 "다음 배치를 고를 수 있는 상태"까지 간다
  let steps = 1000;
  while (steps-- > 0 && gc.phase !== 'place' && gc.phase !== 'blocked_pool' && !gc.done) {
    if (!Engine.aiAct(gc)) break;
  }
  return { board: gc.players[0].board, pool: gc.pool, done: gc.done };
}
function skilledPickFirst(board, pool, scratchSeedBase) {
  const cells = Engine.validCells(board);
  const candidates = [];
  for (let pi = 0; pi < pool.length; pi++) {
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const sim = simulateOnePlacement(board, pool, pi, cell, scratchSeedBase + pi * 97 + cell);
      const remainingPool = sim.pool;
      const firstMoves = Engine.analyzeMoves(null, board, pool).moves.filter(function (m) { return m.pi === pi && m.cell === cell; });
      const firstVal = firstMoves.length ? (firstMoves[0].tier * 1000 + firstMoves[0].value) : 0;
      let secondBest = 0;
      if (!sim.done && remainingPool.length > 0) {
        const an2 = Engine.analyzeMoves(null, sim.board, remainingPool);
        if (an2.moves.length) secondBest = bestMoveValue(an2.moves).bestScore;
      }
      candidates.push({ pi, cell, total: firstVal + secondBest });
    }
  }
  const maxTotal = Math.max.apply(null, candidates.map(function (c) { return c.total; }));
  const top = candidates.filter(function (c) { return c.total === maxTotal; });
  return top;
}
function playSkilled(level, aiSeedCounterRef) {
  const g = freshGame(level, aiSeedCounterRef);
  let steps = 20000;
  while (!g.done && steps-- > 0) {
    if (g.phase === 'place') {
      if (g.placementsThisTurn === 0) {
        const top = skilledPickFirst(g.players[0].board, g.pool, (g.aiRng())*1e9 | 0);
        const pick = top[Math.floor(g.aiRng() * top.length)];
        Engine.place(g, pick.pi, pick.cell);
      } else {
        const an = Engine.analyzeMoves(null, g.players[0].board, g.pool);
        const { best } = bestMoveValue(an.moves);
        const pick = best[Math.floor(g.aiRng() * best.length)];
        Engine.place(g, pick.pi, pick.cell);
      }
      continue;
    }
    if (!Engine.aiAct(g)) break;
  }
  return g;
}

/* ---------- 통계 ---------- */
function percentile(sortedAsc, q) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * sortedAsc.length)));
  return sortedAsc[idx];
}
function goalAchieved(level, g) {
  const s = Engine.finalStats(g)[0];
  const goal = level.goal || { type: 'score' };
  if (goal.type === 'flags') return s.flags >= (goal.count || 1);
  if (goal.type === 'combo') {
    const key = goal.combo; // 'same' | 'consec' | 'color'
    return (s.stats[key] || 0) >= (goal.count || 1);
  }
  if (goal.type === 'noScatter') return s.stats.scatterLines === 0;
  return s.score >= (level.stars ? level.stars[0] : 1); // score
}
// 별1 = 목표 달성(goal.type을 그대로 판정), 별2·3 = 점수 기준(stars[1], stars[2]).
// 요청서 4장 "stars" 설명 그대로: "다른 목표는 목표 달성 = 별 1개, 점수 기준으로 2·3개".
function starsAchieved(level, g) {
  const s = Engine.finalStats(g)[0];
  const stars = level.stars || [];
  const a1 = goalAchieved(level, g);
  const a2 = stars.length > 1 ? s.score >= stars[1] : false;
  const a3 = stars.length > 2 ? s.score >= stars[2] : false;
  return [a1, a2, a3];
}
function summarize(level, games) {
  const scores = games.map(function (g) { return Engine.finalStats(g)[0].score; }).sort(function (a, b) { return a - b; });
  const scatter = games.reduce(function (s, g) { return s + Engine.finalStats(g)[0].stats.scatterLines; }, 0) / games.length;
  const withdrawn = games.reduce(function (s, g) { return s + Engine.finalStats(g)[0].stats.withdrawn; }, 0) / games.length;
  const goalRate = games.filter(function (g) { return goalAchieved(level, g); }).length / games.length;
  const starCounts = [0, 0, 0];
  games.forEach(function (g) {
    const a = starsAchieved(level, g);
    a.forEach(function (ok, i) { if (ok) starCounts[i]++; });
  });
  const starRate = starCounts.map(function (c) { return c / games.length; });
  return {
    n: games.length,
    mean: scores.reduce(function (a, b) { return a + b; }, 0) / games.length,
    p25: percentile(scores, 0.25), p50: percentile(scores, 0.50), p75: percentile(scores, 0.75),
    min: scores[0], max: scores[scores.length - 1],
    scatterMean: scatter, withdrawnMean: withdrawn, goalRate, starRate
  };
}
function suggestStars(avgScores, skilledScores) {
  const s1 = percentile(avgScores.slice().sort(function (a, b) { return a - b; }), 0.30); // 보통 AI 70% 이상 달성
  const s3 = percentile(skilledScores.slice().sort(function (a, b) { return a - b; }), 0.78); // 숙련 AI 약 15-25% 달성
  const s2 = Math.round((s1 + s3) / 2);
  return [Math.max(1, s1), Math.max(s1 + 1, s2), Math.max(s2 + 1, s3)];
}

/* ---------- 메인 ---------- */
function main() {
  const levels = loadLevels();
  const aiSeedCounterRef = { n: 20260927 };
  let failCount = 0;
  const lines = [];
  lines.push('# 단계 검증 결과 (트라이얼 ' + TRIALS + '회, 보통/숙련 AI 각각)');
  lines.push('');

  levels.forEach(function (level) {
    lines.push('## ' + level.id + ' · ' + (level.title || '') + ' (' + level.region + ')' + (level.tutorial ? ' [튜토리얼]' : ''));
    if (isBlockedStart(level.startEyes)) {
      lines.push('❌ **실패: 막힌 판** — 모든 가로·세로줄에 시작 감시의 눈이 있어 절대 무리가 될 수 없습니다. startEyes를 다시 정해야 합니다.');
      failCount++;
      lines.push('');
      return;
    }

    const avgGames = [];
    const skilledGames = [];
    for (let i = 0; i < TRIALS; i++) avgGames.push(playAverage(level, aiSeedCounterRef));
    for (let i = 0; i < Math.max(60, Math.round(TRIALS / 3)); i++) skilledGames.push(playSkilled(level, aiSeedCounterRef));

    const avgStat = summarize(level, avgGames);
    const skStat = summarize(level, skilledGames);

    lines.push('- 목표: ' + JSON.stringify(level.goal || { type: 'score' }) + (level.stars ? (' · 별 기준 ' + level.stars.join(' / ')) : ' · 별 기준 없음'));
    lines.push('- 보통 AI (' + avgStat.n + '판): 평균 ' + avgStat.mean.toFixed(2) + ' · 25/50/75% = ' + avgStat.p25 + '/' + avgStat.p50 + '/' + avgStat.p75 +
      ' · 목표달성률 ' + (avgStat.goalRate * 100).toFixed(1) + '% · 평균 흩어짐 ' + avgStat.scatterMean.toFixed(2) + ' · 평균 감시철수 ' + avgStat.withdrawnMean.toFixed(2));
    lines.push('- 숙련 AI (' + skStat.n + '판): 평균 ' + skStat.mean.toFixed(2) + ' · 25/50/75% = ' + skStat.p25 + '/' + skStat.p50 + '/' + skStat.p75 +
      ' · 목표달성률 ' + (skStat.goalRate * 100).toFixed(1) + '% · 평균 흩어짐 ' + skStat.scatterMean.toFixed(2) + ' · 평균 감시철수 ' + skStat.withdrawnMean.toFixed(2));

    if (level.stars && level.stars.length === 3) {
      lines.push('- 별 달성률 (보통 AI / 숙련 AI): ★' + (avgStat.starRate[0] * 100).toFixed(1) + '% / ' + (skStat.starRate[0] * 100).toFixed(1) +
        '%, ★★' + (avgStat.starRate[1] * 100).toFixed(1) + '% / ' + (skStat.starRate[1] * 100).toFixed(1) +
        '%, ★★★' + (avgStat.starRate[2] * 100).toFixed(1) + '% / ' + (skStat.starRate[2] * 100).toFixed(1) + '%');

      if (level.tutorial) {
        // 튜토리얼은 화면 안내문을 읽는 사람을 가정한 단계라 AI 달성률로 실패 처리하지 않는다.
        // (막힌 판이 아니고, 크래시 없이 끝까지 도는지만 확인됐으면 충분하다)
        lines.push('ℹ️ 튜토리얼 단계 — 별 기준 미달로는 실패 처리하지 않음(안내 문장을 따라가는 사람 기준이라 AI 수치가 낮게 나올 수 있음).');
      } else {
        if (skStat.starRate[0] < 0.001) {
          lines.push('❌ **실패: 숙련 AI가 별 1개를 못 땁니다.** 단계 난이도나 별 기준을 다시 봐야 합니다.');
          failCount++;
        } else if (avgStat.starRate[0] < 0.5) {
          lines.push('⚠️ 보통 AI의 별 1개 달성률이 낮습니다(목표: 약 70%). 별 기준을 낮추는 것을 검토하세요.');
        }
        const suggested = suggestStars(
          avgGames.map(function (g) { return Engine.finalStats(g)[0].score; }),
          skilledGames.map(function (g) { return Engine.finalStats(g)[0].score; })
        );
        lines.push('- (참고) 관측치 기반 제안 별 기준: ' + suggested.join(' / ') + ' — 문서 기준: ' + level.stars.join(' / '));
      }
    } else if (level.goal && level.goal.type !== 'score' && !level.tutorial) {
      if (skStat.goalRate < 0.05) {
        lines.push('❌ **실패: 숙련 AI도 목표를 거의 달성 못 합니다.**');
        failCount++;
      }
    }
    lines.push('');
  });

  lines.push('---');
  lines.push(failCount === 0 ? '✅ 모든 단계 통과' : ('❌ ' + failCount + '개 단계 실패 — 위 항목을 다시 설계하세요.'));
  const report = lines.join('\n');
  console.log(report);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
