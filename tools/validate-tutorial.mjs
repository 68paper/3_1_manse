#!/usr/bin/env node
/*
 * tools/validate-tutorial.mjs
 * ------------------------------------------------------------------
 * 첫 걸음(js/tutorial.js)의 play 장면을 단계대로 끝까지 둬 보고,
 *   - 모든 단계가 엔진의 실제 진행과 맞물리는지(단계가 기다리는 행동을 할 수 있는지)
 *   - 장면이 끝났을 때 판이 끝나고 점수 · 모둠 수가 시나리오와 같은지
 *   - 퀴즈 단계에서 틀린 주사위를 고르면 막히고 힌트가 나오는지
 * 를 확인한다. "아무나 · 아무 칸" 단계는 광장의 첫 주사위와 놓을 수 있는 첫 칸을 쓴다.
 *
 * 실행: node tools/validate-tutorial.mjs
 * 외부 패키지 없음. Node 18+ (ES modules) 필요.
 */
import { TUTORIAL_SCENES, TutorialGame } from '../js/tutorial.js';

// 시나리오(docs/첫걸음_개편_시나리오.md)대로 두었을 때의 기대값
const EXPECT = {
  place: { score: 0, combos: 0 },
  hand: { score: 1, combos: 1, color: 1 },
  link: { score: 2, combos: 1, consec: 1 },
  one: { score: 2, combos: 1, same: 1 },
  keep: { score: 4, combos: 2, consec: 1, same: 1 },
  scatter: { score: 0, combos: 0, scatterLines: 1 },
  spy: { score: 3, combos: 1, same: 1, scatterLines: 1, eyesRemoved: 1 },
  withdraw: { score: 0, combos: 0, withdrawn: 1 },
  cross: { score: 5, combos: 2, cross: 1, eyesRemoved: 1 },
  flag: { score: 6, combos: 1, color: 1, flags: 1 }
};

const errors = [];
function fail(scene, msg) { errors.push(scene.id + ': ' + msg); }

function playScripted(scene) {
  const g = new TutorialGame(scene);
  let guard = 200;
  while (g.step && guard-- > 0) {
    const step = g.step;
    const at = '단계 ' + (g.stepIndex + 1);
    if (step.next) {
      if (!g.next()) { fail(scene, at + ' [다음]이 먹지 않음'); return g; }
      continue;
    }
    if (step.move) {
      if (g.phase !== 'place') { fail(scene, at + ' 놓기를 기다리는데 엔진은 ' + g.phase); return g; }
      // 퀴즈: 처음엔 정답을 강조하지 않고, 틀린 주사위는 막히며, 두 번 틀리면 강조한다
      if (step.move.die && step.move.quiz) {
        if (g.targets().dice.length) fail(scene, at + ' 퀴즈인데 처음부터 정답을 강조함');
        const wrongPi = g.pool.findIndex(function (d) { return !(d.color === step.move.die[0] && d.value === step.move.die[1]); });
        if (wrongPi >= 0) {
          if (g.selectDie(wrongPi) !== false || !g.hint) fail(scene, at + ' 틀린 주사위가 막히지 않음');
          if (g.targets().dice.length) fail(scene, at + ' 한 번 틀렸는데 정답을 강조함');
          g.selectDie(wrongPi);
          if (!g.targets().dice.length) fail(scene, at + ' 두 번 틀렸는데 정답을 강조하지 않음');
        }
      }
      const pi = step.move.die
        ? g.pool.findIndex(function (d) { return d.color === step.move.die[0] && d.value === step.move.die[1]; })
        : 0;
      if (pi < 0) { fail(scene, at + ' 광장에 ' + step.move.die.join('') + '이(가) 없음'); return g; }
      if (!g.selectDie(pi)) { fail(scene, at + ' 주사위를 고르지 못함: ' + g.hint); return g; }
      const cell = step.move.cell != null ? step.move.cell : g.validCells()[0];
      if (g.validCells().indexOf(cell) < 0) { fail(scene, at + ' 칸 ' + cell + '에 놓을 수 없음'); return g; }
      if (!g.placeAt(cell)) { fail(scene, at + ' 놓지 못함: ' + g.hint); return g; }
      continue;
    }
    if (step.keep !== undefined) {
      if (g.phase !== 'combo_keep') { fail(scene, at + ' 남기기를 기다리는데 엔진은 ' + g.phase); return g; }
      const line = g.snapshot().keepLine;
      if (step.keep != null && step.quiz) {
        const other = line.find(function (c) { return c !== step.keep; });
        if (g.chooseKeep(other) !== false || !g.hint) fail(scene, at + ' 틀린 남기기가 막히지 않음');
      }
      if (!g.chooseKeep(step.keep != null ? step.keep : line[0])) { fail(scene, at + ' 남기지 못함'); return g; }
      continue;
    }
    if (step.reward !== undefined) {
      if (g.phase !== 'combo_reward') { fail(scene, at + ' 조각을 기다리는데 엔진은 ' + g.phase); return g; }
      if (step.reward && step.quiz) {
        const other = g.snapshot().rewardOptions.find(function (k) { return k !== step.reward; });
        if (g.chooseReward(other) !== false || !g.hint) fail(scene, at + ' 틀린 조각이 막히지 않음');
      }
      let n = 0;
      while (g.phase === 'combo_reward' && n++ < 10) {
        g.chooseReward(step.reward || g.snapshot().rewardOptions[0]);
      }
      continue;
    }
    if (step.order) {
      if (g.phase !== 'combo_order') { fail(scene, at + ' 순서를 기다리는데 엔진은 ' + g.phase); return g; }
      g.chooseComboOrder(0);
      continue;
    }
    fail(scene, at + ' 알 수 없는 단계');
    return g;
  }
  return g;
}

// 안내 없는 구간(첫 밤길): 첫 주사위 · 첫 칸 · 첫 선택으로 끝까지
function playFree(g) {
  let guard = 500;
  while (!g.done && guard-- > 0) {
    const snap = g.snapshot();
    if (snap.phase === 'place') { g.selectDie(0); g.placeAt(snap.validCells[0]); }
    else if (snap.phase === 'combo_keep') g.chooseKeep(snap.keepLine[0]);
    else if (snap.phase === 'combo_order') g.chooseComboOrder(0);
    else if (snap.phase === 'combo_reward') g.chooseReward(snap.rewardOptions[0]);
    else if (snap.phase === 'combo_eye') g.chooseEye(snap.eyeOptions[0]);
    else if (snap.phase === 'blocked_pool') g.resolveBlockedPool(0);
    else if (snap.phase === 'blocked_eye') g.removeBlockedEye(snap.eyeOptions[0]);
    else break;
  }
}

const lines = [];
TUTORIAL_SCENES.forEach(function (scene) {
  if (scene.kind !== 'play') { lines.push('· ' + scene.title + ' (' + scene.kind + ')'); return; }
  const g = playScripted(scene);
  if (scene.goal) playFree(g);
  if (!g.finished) fail(scene, '단계를 다 지났는데 장면이 끝나지 않음(남은 단계 ' + (g.step ? g.stepIndex + 1 : '없음') + ', 판 끝남 ' + g.done + ')');
  const st = g.player.stats;
  const got = { score: g.score, combos: g.sceneCombos, flags: g.flags };
  Object.assign(got, st);
  const exp = EXPECT[scene.id];
  if (exp) {
    Object.keys(exp).forEach(function (k) {
      if (got[k] !== exp[k]) fail(scene, k + ' 기대 ' + exp[k] + ', 실제 ' + got[k]);
    });
  }
  lines.push('· ' + scene.title + ' — ' + g.score + '점 · 모둠 ' + g.sceneCombos + (scene.goal ? ' · 목표 ' + (g.goalMet ? '달성' : '미달') : ''));
});

console.log(lines.join('\n'));
if (errors.length) {
  console.log('\n실패 ' + errors.length + '건');
  errors.forEach(function (e) { console.log('  ✗ ' + e); });
  process.exit(1);
}
console.log('\n모든 장면 통과');
