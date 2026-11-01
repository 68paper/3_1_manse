/*
 * js/quickRules.js — 게임 중에 여는 「규칙 한눈에」 팝업 내용
 * ------------------------------------------------------------------
 * 본 게임(index.html, 게임 화면의 [규칙] 버튼)과 기기끼리 함께하기(link.html)가 함께 쓴다.
 * 조합(모둠) 규칙과 점수 규칙만 짧게. 자세한 설명은 타이틀의 「규칙 보기」에 있다.
 * 글은 texts/rules.md(quick.combos · quick.score · quick.crackdown)에 있다.
 * 단속의 밤은 점수 대신 숨겨 둔 태극기 장 수를 세므로 점수 부분만 다르게 보여 준다.
 */
import { t } from './texts.js';

// 글은 texts/rules.md의 quick.* 에 있다
/** opts.crackdown: 단속의 밤이면 true, opts.crackdownFlags: { same, consec, color } 모둠마다 숨기는 장 수 */
export function quickRulesHtml(opts) {
  opts = opts || {};
  const score = opts.crackdown ? t('quick.crackdown', opts.crackdownFlags || { same: 2, consec: 2, color: 1 }) : t('quick.score');
  return '<div class="quick-rules">' + t('quick.combos') + score + '</div>';
}

/** 두 화면이 함께 쓰는 팝업 내용 스타일(각 화면의 <style>에 같은 규칙이 없을 때를 위해 한 번만 넣는다) */
export function ensureQuickRulesStyle() {
  if (document.getElementById('quick-rules-style')) return;
  const st = document.createElement('style');
  st.id = 'quick-rules-style';
  st.textContent =
    '.quick-rules h4{font-family:var(--font-title);font-size:15px;margin:10px 0 6px}' +
    '.quick-rules h4:first-child{margin-top:0}' +
    '.quick-rules .combo-example{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13.5px;line-height:1.45}' +
    '.quick-rules .combo-example .dice{display:flex;gap:2px;flex-shrink:0}' +
    '.quick-rules p{margin:8px 0;font-size:14px;line-height:1.5}' +
    '.quick-rules ul{margin:6px 0;padding-left:18px;font-size:13.5px;line-height:1.55}' +
    '.quick-rules li{margin:3px 0}';
  document.head.appendChild(st);
}
