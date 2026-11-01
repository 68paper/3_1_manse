/*
 * js/firstRoll.js — 첫 밤의 고르는 순서 정하기(룰북 「게임 준비」 5)
 * ------------------------------------------------------------------
 * 각자 주사위를 하나씩 굴려 눈이 큰 사람부터 1위, 2위 … 순서로 고른다.
 * 밀정(1)은 가장 작은 눈이다. 눈이 같은 사람끼리는 그 사람들만 다시 굴린다.
 *
 * 자유 연습(한 기기를 돌려 가며)과 기기끼리 함께하기(방장이 판정)가 함께 쓴다.
 * 정해진 순서는 MultiGame의 opts.firstOrder로 넘겨 첫 밤의 순서가 된다.
 */

const COLORS = ['black', 'white', 'red', 'blue'];

/** 주머니에서 꺼내 굴린 주사위 하나: { color, value } */
export function rollDie(rng) {
  const r = rng || Math.random;
  return { color: COLORS[Math.floor(r() * COLORS.length)], value: 1 + Math.floor(r() * 6) };
}

export class FirstRoll {
  constructor(n) {
    this.n = n;
    this.history = [];       // 자리마다 지금까지 굴린 눈들(다시 굴리면 뒤에 붙는다)
    this.faces = [];         // 자리마다 마지막으로 굴린 주사위(그림용)
    for (let i = 0; i < n; i++) { this.history.push([]); this.faces.push(null); }
    this.active = [];        // 이번에 굴려야 하는 자리
    for (let i = 0; i < n; i++) this.active.push(i);
    this.current = {};       // 이번 차례에 이미 굴린 자리 → 눈
    this.rerolls = 0;        // 다시 굴린 횟수
  }

  get done() { return this.active.length === 0; }

  /** 이 자리가 지금 굴려야 하는지 */
  needs(seat) { return this.active.indexOf(seat) >= 0 && this.current[seat] == null; }

  /** 굴린 결과를 적는다. 이번 차례의 모두가 굴리면 같은 눈끼리 다시 굴릴 자리를 정한다 */
  roll(seat, die) {
    if (!this.needs(seat) || !die || !(die.value >= 1 && die.value <= 6)) return false;
    this.current[seat] = die.value;
    this.faces[seat] = { color: die.color, value: die.value };
    const self = this;
    if (this.active.some(function (s) { return self.current[s] == null; })) return true;
    // 이번 차례가 끝났다: 기록에 붙이고, 기록이 똑같은 자리끼리 다시 굴린다
    this.active.forEach(function (s) { self.history[s].push(self.current[s]); });
    const groups = {};
    this.active.forEach(function (s) {
      const key = self.history[s].join(',');
      (groups[key] = groups[key] || []).push(s);
    });
    const next = [];
    Object.keys(groups).forEach(function (k) { if (groups[k].length > 1) next.push.apply(next, groups[k]); });
    next.sort(function (a, b) { return a - b; });
    if (next.length) this.rerolls++;
    this.active = next;
    this.current = {};
    return true;
  }

  /** 지금까지 정해진 순서(자리 번호, 1위부터). 다 정해지기 전에도 앞선 순서대로 보여 줄 수 있다 */
  order() {
    const h = this.history;
    const ids = [];
    for (let i = 0; i < this.n; i++) ids.push(i);
    return ids.sort(function (a, b) {
      const ha = h[a], hb = h[b];
      for (let k = 0; k < Math.max(ha.length, hb.length); k++) {
        const va = ha[k] == null ? 0 : ha[k], vb = hb[k] == null ? 0 : hb[k];
        if (va !== vb) return vb - va;
      }
      return a - b;
    });
  }

  /** 자리마다 순위(1부터). 아직 같은 눈으로 묶여 있으면 같은 순위 */
  ranks() {
    const order = this.order();
    const h = this.history;
    const out = new Array(this.n);
    let rank = 0, prevKey = null;
    order.forEach(function (s, i) {
      const key = h[s].join(',');
      if (key !== prevKey) { rank = i + 1; prevKey = key; }
      out[s] = h[s].length ? rank : null;
    });
    return out;
  }
}
