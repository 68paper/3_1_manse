/*
 * js/link/connlog.js — 연결 기록(시험판)
 * ------------------------------------------------------------------
 * 연결이 왜 끊겼는지 나중에 알아볼 수 있도록, 연결 상태 변화와 그 무렵의 기기 상황
 * (화면 꺼짐 · 다른 앱으로 전환 · Wi-Fi 끊김 · 화면 켜짐 유지)을 시각과 함께 적어 둔다.
 * 화면을 새로 고쳐도 남도록 localStorage에 최근 300줄만 보관한다. 이 기기 안에만 있고
 * 어디로도 보내지 않으며, 사람이 [기록 복사]를 눌러야 밖으로 나간다.
 */

const KEY = 'manse-eve:v1:linkLog';
const MAX = 300;

let entries = load();
let listeners = [];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) { /* 저장 실패는 무시: 이번 실행 동안은 화면에 남는다 */ }
}

function stamp(t) {
  const d = new Date(t);
  const p = function (n, w) { return String(n).padStart(w || 2, '0'); };
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

export const ConnLog = {
  /** 한 줄 적기. who: 'me' 또는 상대 이름 · 자리, what: 짧은 설명 */
  add(who, what) {
    entries.push({ t: Date.now(), w: String(who || ''), m: String(what || '') });
    if (entries.length > MAX) entries = entries.slice(entries.length - MAX);
    save();
    listeners.forEach(function (fn) { fn(); });
  },
  clear() { entries = []; save(); listeners.forEach(function (fn) { fn(); }); },
  onChange(fn) { listeners.push(fn); },
  get size() { return entries.length; },
  /** 복사해서 보내기 좋은 글자로 */
  text() {
    return entries.map(function (e) { return stamp(e.t) + '  [' + e.w + '] ' + e.m; }).join('\n');
  }
};

/** 이 기기의 정보(기록 맨 앞에 한 번) */
export function deviceSummary() {
  const n = navigator;
  const conn = n.connection || n.mozConnection || n.webkitConnection;
  return [
    n.userAgent,
    '화면 ' + screen.width + '×' + screen.height,
    conn ? '네트워크 ' + (conn.type || '?') + ' · ' + (conn.effectiveType || '?') : '',
    '온라인 ' + n.onLine
  ].filter(Boolean).join(' · ');
}
