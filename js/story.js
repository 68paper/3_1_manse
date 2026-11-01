/*
 * js/story.js — '스무하루의 밤' 이야기 카드
 * ------------------------------------------------------------------
 * 1번째 밤 = 1919년 2월 8일(2·8 독립선언), 21번째 밤 = 2월 28일 밤(최종 회합),
 * 21밤을 모두 넘기면 새벽 = 3월 1일.
 * 원문에 정확한 날짜가 없는 일("2월 초", "2월 하순" 등)은 그 기간 안의 밤에 배치하고,
 * 카드의 period에는 원문의 시기 표현을 그대로 적는다(날짜를 지어내지 않기 위해).
 * 카드 글은 texts/stories.md에 있다.
 */
import { t, tText, textKeys } from './texts.js';

export const STORY_START_DAY = 8; // 1번째 밤 = 2월 8일

/** n번째 밤의 날짜 문자열 */
export function nightDate(n) {
  return '2월 ' + (STORY_START_DAY - 1 + n) + '일';
}

// 카드의 글은 texts/stories.md에 있다. 글 파일을 읽은 뒤 buildStories()가 아래 세 객체를 채운다
// (객체 자체는 그대로 두고 내용만 채우므로, 이 모듈을 가져다 쓰는 곳은 바꿀 필요가 없다).

/** 시작 전: 1919년 초의 분위기 */
export const PROLOGUE = {};

/** 밤 번호 → 카드. 없는 밤은 카드 없이 넘어간다 */
export const NIGHT_STORIES = {};

/** 21밤을 모두 넘긴 새벽 */
export const MARCH_FIRST = {};

function card(prefix) {
  return { period: tText(prefix + '.period'), title: tText(prefix + '.title'), body: t(prefix + '.body') };
}

/** texts/stories.md를 읽은 뒤 한 번 부른다. story.night.번호.title이 있는 밤마다 카드를 만든다 */
export function buildStories() {
  Object.assign(PROLOGUE, card('story.prologue'));
  Object.assign(MARCH_FIRST, card('story.march1'));
  Object.keys(NIGHT_STORIES).forEach(function (k) { delete NIGHT_STORIES[k]; });
  textKeys().forEach(function (k) {
    const m = /^story\.night\.(\d+)\.title$/.exec(k);
    if (m) NIGHT_STORIES[Number(m[1])] = card('story.night.' + m[1]);
  });
}

/** n번째 밤까지 중 가장 최근 카드(다시 보기용). 없으면 프롤로그 */
export function latestStory(n) {
  for (let i = n; i >= 1; i--) if (NIGHT_STORIES[i]) return { night: i, story: NIGHT_STORIES[i] };
  return { night: 0, story: PROLOGUE };
}
