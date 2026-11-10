/*
 * js/boardView.js — 3×3 판의 칸을 그린다(본 화면 · 기기끼리 함께하기 공용, 모양은 css/base.css)
 */
import { dieIcon } from './art.js';

/**
 * 판의 칸 아홉 개를 HTML로.
 *   board: 칸마다 주사위({ color, value }) 또는 null
 *   opts.valid / opts.choosable: 놓을 수 있는 칸 · 고를 수 있는 칸 번호 목록
 *   opts.pulse: 방금 놓아 한 번 튕길 칸 번호
 *   opts.clickable: false면 누를 수 없는 판(다른 사람 판) — data-cell을 붙이지 않는다
 *   opts.size: 주사위 그림 크기(기본 50)
 *   opts.decorate(i, die): 칸마다 더할 것 { classes: [...], extra: 'html' } (없으면 null)
 */
export function boardCellsHtml(board, opts) {
  opts = opts || {};
  let html = '';
  for (let i = 0; i < 9; i++) {
    const die = board[i];
    const classes = ['cell'];
    let extra = '';
    if (opts.valid && opts.valid.indexOf(i) >= 0) classes.push('valid');
    if (opts.choosable && opts.choosable.indexOf(i) >= 0) classes.push('choosable');
    if (opts.decorate) {
      const more = opts.decorate(i, die);
      if (more && more.classes) Array.prototype.push.apply(classes, more.classes);
      if (more && more.extra) extra = more.extra;
    }
    if (opts.pulse === i) classes.push('pulse');
    html += '<div class="' + classes.join(' ') + '"' + (opts.clickable === false ? '' : ' data-cell="' + i + '"') + '>' +
      (die ? dieIcon(die.color, die.value, opts.size || 50) : '') + extra + '</div>';
  }
  return html;
}
