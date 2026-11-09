/*
 * js/texts.js — 게임 속 글(texts/*.md)을 읽어 화면에 넣기
 * ------------------------------------------------------------------
 * 이야기 · 안내처럼 긴 글은 코드 대신 texts/ 폴더의 마크다운 파일에 있다.
 * 사람이 GitHub 웹에서 바로 고칠 수 있도록, 형식은 아주 단순하게 둔다(texts/README.md 참고).
 *
 *   ## 아이디              ← 글의 이름. 코드가 이 이름으로 글을 찾는다(고치지 않는다)
 *   > 어디에 보이는지 메모   ← 이름 바로 아래의 '>' 줄은 메모(화면에 안 나옴)
 *   글 …                   ← 여기를 고친다
 *
 * 글 안에서 쓸 수 있는 꾸밈
 *   **굵게** · 빈 줄 = 문단 나눔 · 한 줄 바꿈 = 줄 바꿈 · '- ' 목록 · '1. ' 번호 목록
 *   '### 제목' · '#### 작은 제목' · [주사위: 빨4 검4 흰4] (주사위 그림, 같은 문단 뒤 글은 옆에 붙음)
 *   '※ '로 시작하는 문단 = 작고 흐린 글(덧붙이는 말)
 *   {이름} 같은 중괄호는 게임이 값을 끼워 넣는 자리(지우지 않는다)
 * HTML은 쓸 수 없다(글자 그대로 보인다).
 *
 * 글을 못 찾으면 화면에 '⚠ 아이디'가 보인다. tools/validate-texts.mjs가 미리 잡아낸다.
 */
import { dieIcon } from './art.js';

export const TEXT_FILES = ['title', 'tutorial', 'stories', 'crackdown', 'rules', 'link'];

const store = new Map();
const COLOR_WORD = { '흰': 'white', '검': 'black', '빨': 'red', '파': 'blue' };

/** 마크다운 파일 하나를 { 아이디: 글 } 로 */
export function parseTexts(src) {
  const out = {};
  let key = null, lines = [], inNotes = false;
  const flush = function () {
    if (key) out[key] = lines.join('\n').replace(/^\n+|\n+$/g, '');
  };
  String(src).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
    const h = /^## +(\S+)\s*$/.exec(line);
    if (h) { flush(); key = h[1]; lines = []; inNotes = true; return; }
    if (/^# /.test(line)) { flush(); key = null; return; } // 파일 제목 · 구역 제목
    if (!key) return;                                       // 첫 아이디 전의 설명은 무시
    if (inNotes && /^>/.test(line)) return;                 // 아이디 바로 아래 메모
    if (inNotes && line.trim() === '') return;
    inNotes = false;
    lines.push(line);
  });
  flush();
  return out;
}

/** 읽은 글을 넣는다(브라우저는 loadTexts, Node 도구는 파일을 읽어 직접) */
export function setTexts(map) {
  Object.keys(map).forEach(function (k) { store.set(k, map[k]); });
}

/** 브라우저: texts/*.md를 모두 읽는다. 하나라도 못 읽으면 그 파일의 글만 빠진다 */
export async function loadTexts(names, base) {
  const list = names || TEXT_FILES;
  await Promise.all(list.map(async function (name) {
    try {
      const res = await fetch((base || '') + 'texts/' + name + '.md', { cache: 'no-cache' }); // 고친 글이 바로 보이게
      if (!res.ok) throw new Error(res.status);
      setTexts(parseTexts(await res.text()));
    } catch (e) {
      console.warn('글 파일을 읽지 못했어요: texts/' + name + '.md', e);
    }
  }));
}

export function hasText(key) { return store.has(key); }
export function textKeys() { return Array.from(store.keys()); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

// 한 줄 안의 꾸밈: **굵게**, {값}
function inline(text, vars) {
  let s = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return s.replace(/\{([^{}\s]+)\}/g, function (m, name) {
    return vars && Object.prototype.hasOwnProperty.call(vars, name) ? esc(vars[name]) : m;
  });
}

function diceRow(spec) {
  return spec.trim().split(/\s+/).map(function (tok) {
    const color = COLOR_WORD[tok.charAt(0)];
    const value = Number(tok.slice(1));
    return color && value >= 1 && value <= 6 ? dieIcon(color, value, 34) : '';
  }).join('');
}

/**
 * 글을 HTML로. 문단이 하나뿐이고 목록 · 제목 · 주사위가 없으면 <p> 없이 한 줄 글로(말풍선 · 버튼 옆 등에 쓰기 좋게)
 * vars: { 이름: 값 } — {이름} 자리에 넣을 값(글자 그대로 들어간다)
 */
export function t(key, vars) {
  if (!store.has(key)) return '⚠ ' + esc(key);
  const blocks = store.get(key).split(/\n\s*\n/);
  const isPlain = blocks.length === 1 && !/^(\s*[-*] |\s*\d+\. |#{3,4} |\[주사위:|※ )/m.test(blocks[0]);
  if (isPlain) return blocks[0].split('\n').map(function (l) { return inline(l, vars); }).join('<br>');
  return blocks.map(function (block) {
    const lines = block.split('\n');
    const head = /^(#{3,4}) +(.*)$/.exec(lines[0]);
    if (head && lines.length === 1) return '<h' + (head[1].length) + '>' + inline(head[2], vars) + '</h' + (head[1].length) + '>';
    if (lines.every(function (l) { return /^\s*[-*] /.test(l); })) {
      return '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-*] /, ''), vars) + '</li>'; }).join('') + '</ul>';
    }
    if (lines.every(function (l) { return /^\s*\d+\. /.test(l); })) {
      return '<ol>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+\. /, ''), vars) + '</li>'; }).join('') + '</ol>';
    }
    const dice = /^\[주사위:([^\]]*)\]\s*(.*)$/.exec(lines[0]);
    if (dice) {
      const rest = [dice[2]].concat(lines.slice(1)).filter(function (l) { return l.trim(); });
      return '<div class="combo-example"><div class="dice">' + diceRow(dice[1]) + '</div><div>' +
        rest.map(function (l) { return inline(l, vars); }).join('<br>') + '</div></div>';
    }
    if (/^※ /.test(lines[0])) {
      lines[0] = lines[0].replace(/^※ /, '');
      return '<p class="muted">' + lines.map(function (l) { return inline(l, vars); }).join('<br>') + '</p>';
    }
    return '<p>' + lines.map(function (l) { return inline(l, vars); }).join('<br>') + '</p>';
  }).join('');
}

/** 꾸밈 없는 글자(제목 · 버튼 · 알림처럼 HTML을 넣지 않는 곳) */
export function tText(key, vars) {
  if (!store.has(key)) return '⚠ ' + key;
  return store.get(key).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\{([^{}\s]+)\}/g, function (m, name) {
    return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
  }).replace(/\s*\n\s*/g, ' ').trim();
}

/** data-text="아이디"가 붙은 요소를 그 글로 채운다(정적인 안내 글) */
export function fillTextSlots(root) {
  (root || document).querySelectorAll('[data-text]').forEach(function (el) {
    el.innerHTML = t(el.dataset.text);
  });
}
