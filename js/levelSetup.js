/*
 * 레벨 데이터(data/levels.json의 한 항목) → 엔진 설정/초기 배치.
 * 브라우저(js/solo.js)와 Node(tools/validate-levels.mjs) 양쪽에서 그대로 가져다 쓴다.
 * 판정 로직은 건드리지 않는다 — 여기서는 오직 "레벨 → 설정값" 변환만 한다.
 */

var ROWS = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
var COLS = [[0, 3, 6], [1, 4, 7], [2, 5, 8]];

/**
 * "막힌 판" 판정: 가로 세 줄과 세로 세 줄 모두에 시작 감시의 눈이 하나씩 이상 있으면,
 * 어떤 줄도 영원히 무리가 될 수 없다 (한 줄에 1이 하나만 있어도 그 줄은 조합 불가).
 * 요청서 4장의 "설계 규칙" 그대로.
 */
export function isBlockedStart(startEyes) {
  if (!startEyes || startEyes.length === 0) return false;
  var set = {};
  startEyes.forEach(function (c) { set[c] = true; });
  var hasEye = function (line) { return line.some(function (c) { return set[c]; }); };
  return ROWS.every(hasEye) && COLS.every(hasEye);
}

/** 레벨 데이터 → Engine.create()에 넘길 settings 객체 */
export function buildSoloSettings(level, playerType) {
  return {
    n: 1,
    types: [playerType || 'human'],
    seed: level.seed,
    ruleMode: 'basic', // 요청서: 심화 규칙은 오늘 범위 밖
    maxRounds: level.nights || 8,
    poolSize: level.poolSize || 4,
    eyeChance: (level.eyeChance != null) ? level.eyeChance : null,
    scriptedPools: level.scriptedPools || null
  };
}

/**
 * startEyes를 판에 배치한다. 색은 이 레벨의 게임 난수(g.rng)에서 정한다 —
 * 그래야 "같은 시드 = 같은 결과" 가 startEyes가 있는 레벨에서도 유지된다.
 * 반드시 Engine.create() 직후, 그 레벨의 첫 Engine.startRound() 호출 전에 부른다.
 */
export function applyStartEyes(Engine, g, startEyes) {
  if (!startEyes || startEyes.length === 0) return;
  var p = g.players[0];
  startEyes.forEach(function (cell) {
    var drawn = Engine.drawFromBag(g.bag, 1, g.rng);
    p.board[cell] = { color: drawn.colors[0], value: 1 };
  });
}

/** 자유 연습용: 무작위 시드 (캠페인과 달리 매번 새로 만듦) */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967295) >>> 0;
}

