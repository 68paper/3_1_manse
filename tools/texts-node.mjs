/*
 * tools/texts-node.mjs — Node 도구에서 게임 속 글(texts/*.md)을 읽어 js/texts.js에 넣기
 * 브라우저는 js/texts.js의 loadTexts()가 fetch로 읽고, Node 도구는 이 파일로 디스크에서 읽는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TEXT_FILES, parseTexts, setTexts } from '../js/texts.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 모든 글 파일을 읽어 넣고, 파일별 원문과 읽은 결과를 돌려준다(검증용) */
export function loadTextsFromDisk() {
  const files = {};
  TEXT_FILES.forEach(function (name) {
    const src = readFileSync(path.join(ROOT, 'texts', name + '.md'), 'utf8');
    const map = parseTexts(src);
    setTexts(map);
    files[name] = { src: src, map: map };
  });
  return files;
}
