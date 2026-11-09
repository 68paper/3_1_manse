#!/usr/bin/env node
/*
 * tools/validate-texts.mjs
 * ------------------------------------------------------------------
 * 게임 속 글(texts/*.md)을 검사한다. 글을 고친 뒤 돌려 보면 된다.
 *
 *   오류(실패): 게임이 찾는 글이 없음 · 같은 아이디가 두 번 · 값 자리({…})가 빠짐
 *   경고: 게임이 쓰지 않는 아이디(제목 오타일 수 있음) · 모르는 값 자리 · 빈 글
 *
 * 실행: node tools/validate-texts.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadTextsFromDisk } from './texts-node.mjs';
import { TUTORIAL_SCENES } from '../js/tutorial.js';

const errors = [], warns = [];
const files = loadTextsFromDisk();
const all = {};                // 아이디 → 글
const fileOf = {};             // 아이디 → 파일
Object.keys(files).forEach(function (name) {
  // 같은 아이디가 두 번(파일 안이든 파일끼리든)
  const seen = {};
  (files[name].src.match(/^## +\S+/gm) || []).forEach(function (h) {
    const k = h.replace(/^## +/, '');
    if (seen[k]) errors.push('texts/' + name + '.md: 아이디가 두 번 나와요 — ' + k);
    seen[k] = true;
    if (fileOf[k] && fileOf[k] !== name) errors.push('같은 아이디가 두 파일에 있어요 — ' + k + ' (texts/' + fileOf[k] + '.md, texts/' + name + '.md)');
    fileOf[k] = name;
  });
  Object.assign(all, files[name].map);
});

const required = new Set();      // 꼭 있어야 하는 글
const optional = new Set();      // 있어도 되는 글(장면별 힌트 등)
const need = function (k) { required.add(k); };

// ---- 첫 걸음 ----
['home.new', 'home.progress', 'home.done', 'common.waitNext',
  'common.hint.die', 'common.hint.invalid', 'common.hint.cell', 'common.hint.keep', 'common.hint.reward'].forEach(need);
TUTORIAL_SCENES.forEach(function (sc) {
  need(sc.id + '.title'); need(sc.id + '.sub');
  if (sc.kind === 'story') {
    need(sc.id + '.card.1');
    for (let i = 2; all[sc.id + '.card.' + i] != null; i++) optional.add(sc.id + '.card.' + i);
  }
  if (sc.kind === 'dice') ['colors', 'order', 'spy', 'spyInfo', 'idle', 'spyEarly', 'spyDesc'].forEach(function (s) { need('people.' + s); });
  (sc.steps || []).forEach(function (st, i) {
    const k = sc.id + '.' + (i + 1);
    need(k + '.say');
    optional.add(k + '.place');
    Object.keys(all).forEach(function (key) { if (key.indexOf(k + '.hint.') === 0) optional.add(key); });
  });
  if (sc.summary) need(sc.id + '.summary');
  if (sc.summary && sc.summary.extra) {
    need(sc.id + '.extra.title');
    sc.summary.extra.boards.forEach(function (b, i) { need(sc.id + '.extra.' + (i + 1)); });
  }
  if (sc.goal) ['free.good.title', 'free.good', 'free.bad.title', 'free.bad'].forEach(need);
});
// 단계 수보다 큰 번호의 글(단계를 지웠거나 번호가 밀렸을 때)
Object.keys(all).forEach(function (key) {
  const m = /^([a-z]+)\.(\d+)\./.exec(key);
  if (!m) return;
  const sc = TUTORIAL_SCENES.find(function (s) { return s.id === m[1]; });
  if (sc && sc.steps && Number(m[2]) > sc.steps.length) errors.push('texts/tutorial.md: ' + key + ' — ' + sc.id + ' 장면은 ' + sc.steps.length + '단계까지예요(단계 번호가 밀렸을 수 있어요)');
});

// ---- 스무하루의 밤 ----
['story.prologue', 'story.march1'].forEach(function (p) { ['period', 'title', 'body'].forEach(function (f) { need(p + '.' + f); }); });
Object.keys(all).forEach(function (key) {
  const m = /^story\.night\.(\d+)\.(period|title|body)$/.exec(key);
  if (!m) return;
  const n = Number(m[1]);
  if (n < 1 || n > 21) errors.push('texts/stories.md: ' + key + ' — 밤 번호는 1부터 21까지예요');
  ['period', 'title', 'body'].forEach(function (f) { need('story.night.' + n + '.' + f); });
});

// ---- 단속의 밤 ----
JSON.parse(readFileSync(path.join(ROOT, 'data', 'crackdown.json'), 'utf8')).stories.forEach(function (s) {
  need('cd.' + s.id + '.name'); need('cd.' + s.id + '.background'); optional.add('cd.' + s.id + '.period');
});

// ---- 규칙 ----
const uiSrc = readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
const sec = /const RULES_SECTIONS = \[([^\]]*)\]/.exec(uiSrc);
(sec ? sec[1].match(/'[^']+'/g) : []).forEach(function (q) { need(q.slice(1, -1)); });
['rules.people.spy', 'quick.combos', 'quick.score', 'quick.crackdown'].forEach(need);

// ---- 처음 화면 · 기기끼리 함께하기: HTML의 data-text, 처음 화면 ⓘ 설명 카드 ----
['index.html', 'link.html'].forEach(function (f) {
  (readFileSync(path.join(ROOT, f), 'utf8').match(/data-text="[^"]+"/g) || []).forEach(function (m) { need(m.slice(11, -1)); });
});
(readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/data-info="[^"]+"/g) || []).forEach(function (m) { need('title.' + m.slice(11, -1) + '.more'); });

// ---- 값 자리 ----
const VARS = {
  'home.progress': ['done', 'total'],
  'people.colors': ['seen', 'total'],
  'rules.crackdown': ['start_flags', 'same', 'consec', 'color', 'star1', 'star2', 'star3'],
  'quick.crackdown': ['same', 'consec', 'color']
};

required.forEach(function (k) {
  if (all[k] == null) errors.push('글이 없어요 — ## ' + k);
  else if (!all[k].trim() && !/^cd\..*\.period$/.test(k)) warns.push('빈 글 — ## ' + k);
});
Object.keys(all).forEach(function (k) {
  if (!required.has(k) && !optional.has(k)) warns.push('게임이 쓰지 않는 아이디(제목 오타?) — ## ' + k + ' (texts/' + fileOf[k] + '.md)');
  const used = (all[k].match(/\{[^{}\s]+\}/g) || []).map(function (v) { return v.slice(1, -1); });
  const allowed = VARS[k] || [];
  allowed.forEach(function (v) { if (used.indexOf(v) < 0) errors.push('값 자리가 빠졌어요 — ## ' + k + ' 에 {' + v + '}'); });
  used.forEach(function (v) { if (allowed.indexOf(v) < 0) warns.push('모르는 값 자리 — ## ' + k + ' 의 {' + v + '} (글자 그대로 보여요)'); });
  if (/<[a-z][^>]*>/i.test(all[k])) warns.push('HTML은 쓸 수 없어요(글자 그대로 보여요) — ## ' + k);
});

const count = Object.keys(all).length;
console.log('글 ' + count + '개 (' + Object.keys(files).map(function (n) { return n + ' ' + Object.keys(files[n].map).length; }).join(' · ') + ')');
warns.forEach(function (w) { console.log('  △ ' + w); });
if (errors.length) {
  errors.forEach(function (e) { console.log('  ✗ ' + e); });
  console.log('\n실패 ' + errors.length + '건' + (warns.length ? ' · 경고 ' + warns.length + '건' : ''));
  process.exit(1);
}
console.log('\n통과' + (warns.length ? ' · 경고 ' + warns.length + '건' : ''));
