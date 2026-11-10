/*
 * js/common.js — 본 화면(ui.js)과 기기끼리 함께하기(link/linkui.js)가 함께 쓰는 작은 것들
 */
import { Sound } from './audio.js';

export const PIECE_NAME = { taegeuk: '태극', geon: '건', ri: '리', gam: '감', gon: '곤' };
export const PIECE_ORDER = ['taegeuk', 'geon', 'ri', 'gam', 'gon'];
export const COMBO_NAME = { same: '한뜻', consec: '연락망', color: '한동네' };

/** 화면에 넣기 전에 글자를 안전하게(이름처럼 사람이 적은 글 · 다른 기기에서 온 글) */
export function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** 설정(배경음 · 효과음)을 소리에 적용 */
export function applySoundSettings(settings) {
  Sound.configure({ bgm: settings.bgm !== false, sfx: settings.sfx !== false });
}

/** 오프라인에서도 열리게(선택 사항이라 실패해도 조용히 넘어간다) */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 무시 */ });
  }
}
