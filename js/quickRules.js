/*
 * js/quickRules.js — 게임 중에 여는 「규칙 한눈에」 팝업 내용
 * ------------------------------------------------------------------
 * 본 게임(index.html, 게임 화면의 [규칙] 버튼)과 기기끼리 함께하기(link.html)가 함께 쓴다.
 * 조합(모둠) 규칙과 점수 규칙만 짧게. 자세한 설명은 타이틀의 「규칙 보기」에 있다.
 * 단속의 밤은 점수 대신 숨겨 둔 태극기 장 수를 세므로 점수 부분만 다르게 보여 준다.
 */
import { dieIcon } from './art.js';

function dice(list) {
  return '<span class="qr-dice">' + list.map(function (d) { return dieIcon(d[0], d[1], 34); }).join('') + '</span>';
}

/** opts.crackdown: 단속의 밤이면 true, opts.crackdownFlags: { same, consec, color } 모둠마다 숨기는 장 수 */
export function quickRulesHtml(opts) {
  opts = opts || {};
  const combos =
    '<h4>모둠 — 가로나 세로 한 줄이 셋으로 가득 차면</h4>' +
    '<div class="qr-row">' + dice([['red', 4], ['black', 4], ['white', 4]]) + '<div><b>한뜻</b> 눈이 모두 같고 색이 모두 다름</div></div>' +
    '<div class="qr-row">' + dice([['blue', 3], ['blue', 4], ['blue', 5]]) + '<div><b>연락망</b> 색이 같고 눈이 이어짐(2·3·4 / 3·4·5 / 4·5·6)</div></div>' +
    '<div class="qr-row">' + dice([['white', 2], ['white', 5], ['white', 6]]) + '<div><b>한동네</b> 색이 같고 눈이 모두 다름(이어지지 않음)</div></div>' +
    '<ul>' +
      '<li>밀정(1)이 하나라도 있는 줄은 모둠이 될 수 없어요. 대각선은 해당 없어요.</li>' +
      '<li>모둠이 되면 <b>한 사람만 남고</b> 둘은 주머니로 돌아가요.</li>' +
      '<li>한 번에 가로 · 세로가 함께 모둠이 되면 <b>교차 완성</b> — 놓은 사람이 남고 두 모둠을 모두 받아요.</li>' +
      '<li>꽉 찼는데 모둠이 아니면 <b>흩어져요</b>(밀정만 남음). 밀정 셋으로만 찬 줄은 <b>감시 철수</b>로 모두 사라져요.</li>' +
    '</ul>';

  let score;
  if (opts.crackdown) {
    const f = opts.crackdownFlags || { same: 2, consec: 2, color: 1 };
    score =
      '<h4>숨겨 둔 태극기(단속의 밤)</h4>' +
      '<table class="qr-table"><tr><th>모둠</th><th>숨기는 태극기</th></tr>' +
      '<tr><td>한뜻</td><td>+' + f.same + '장 (판의 밀정 하나도 쫓아냄)</td></tr>' +
      '<tr><td>연락망</td><td>+' + f.consec + '장</td></tr>' +
      '<tr><td>한동네</td><td>+' + f.color + '장</td></tr></table>' +
      '<ul><li>손에서 밀정을 놓으면 1장을 빼앗겨요.</li><li>낮 단속 칸이 비어 있으면 밀정이 들어와 1장을 빼앗아 가요.</li>' +
      '<li>단속의 밤은 조각 대신 장 수로 세서, 밀정을 쫓아내도 장 수가 늘지는 않아요.</li></ul>';
  } else {
    score =
      '<h4>점수</h4>' +
      '<table class="qr-table"><tr><th>모둠</th><th>받는 것</th></tr>' +
      '<tr><td>한뜻</td><td>판의 밀정 하나 쫓아내기 <b>+1점</b> + 원하는 조각 2개</td></tr>' +
      '<tr><td>연락망</td><td>원하는 조각 2개</td></tr>' +
      '<tr><td>한동네</td><td>원하는 조각 1개</td></tr></table>' +
      '<p class="qr-formula">점수 = <b>조각 수</b> + <b>완성한 태극기 장수</b> + <b>쫓아낸 밀정 수</b></p>' +
      '<ul>' +
        '<li>조각 하나 = 1점. 태극 · 건 · 리 · 감 · 곤 다섯 자리가 모두 찍히면 태극기 한 장 완성, <b>+1점</b> 더.</li>' +
        '<li>한뜻으로 쫓아낸 밀정 하나 = <b>+1점</b>. 판에 밀정이 없으면 조각만 받아요.</li>' +
        '<li>감시 철수로 사라진 밀정, 놓을 곳이 없어 치운 밀정에는 점수가 없어요.</li>' +
        '<li>같은 점수면 나중에 그 점수에 올라선 사람이 앞서요.</li>' +
      '</ul>';
  }
  return '<div class="quick-rules">' + combos + score + '</div>';
}

/** 두 화면이 함께 쓰는 팝업 내용 스타일(각 화면의 <style>에 같은 규칙이 없을 때를 위해 한 번만 넣는다) */
export function ensureQuickRulesStyle() {
  if (document.getElementById('quick-rules-style')) return;
  const st = document.createElement('style');
  st.id = 'quick-rules-style';
  st.textContent =
    '.quick-rules h4{font-family:var(--font-title);font-size:15px;margin:10px 0 6px}' +
    '.quick-rules h4:first-child{margin-top:0}' +
    '.quick-rules .qr-row{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13.5px;line-height:1.45}' +
    '.quick-rules .qr-dice{display:flex;gap:2px;flex-shrink:0}' +
    '.quick-rules ul{margin:6px 0;padding-left:18px;font-size:13.5px;line-height:1.55}' +
    '.quick-rules li{margin:3px 0}' +
    '.quick-rules .qr-table{width:100%;border-collapse:collapse;font-size:13.5px}' +
    '.quick-rules .qr-table th{text-align:left;font-size:12px;opacity:.65;padding:3px 4px;border-bottom:1.5px solid rgba(42,34,27,.3)}' +
    '.quick-rules .qr-table td{padding:5px 4px;border-bottom:1px solid rgba(42,34,27,.15);vertical-align:top}' +
    '.quick-rules .qr-table td:first-child{font-weight:700;white-space:nowrap}' +
    '.quick-rules .qr-formula{background:rgba(205,189,152,.45);border-radius:8px;padding:6px 8px;margin:8px 0 2px;font-size:14px}';
  document.head.appendChild(st);
}
