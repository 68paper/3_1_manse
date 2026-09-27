/*
 * js/art.js — 픽셀 · 태극기 그리기
 * ------------------------------------------------------------------
 * 외부 이미지 파일 없이 코드로 그린다. 모든 함수는 HTML 문자열(SVG 마크업)을
 * 반환하는 순수 함수다. DOM 삽입은 ui.js가 담당한다.
 *
 * 태극기 규격(제작요청서 7장):
 *   - 가로:세로 = 3:2, 태극 지름 = 세로의 1/2, 중심 = 깃발 중심
 *   - S자: 왼쪽 위(건)→오른쪽 아래(곤) 대각선을 지름으로 하는 두 반원.
 *     왼쪽 반원은 대각선 아래쪽으로 볼록, 오른쪽 반원은 위쪽으로 볼록. 위=빨강, 아래=파랑
 *   - 괘: 왼쪽 위 건(☰) · 오른쪽 아래 곤(☷) · 오른쪽 위 감(☵) · 왼쪽 아래 리(☲),
 *     괘의 막대는 대각선에 수직
 *
 * 표준(세로 지름 기준) 태극 S자 공식을 -45도 회전시켜 대각선 버전을 얻는다.
 * (세로 지름 기준일 때 왼쪽 반원이 위로, 오른쪽 반원이 아래로 볼록한 표준 태극 공식을
 *  -45도 회전하면 "왼쪽 위-오른쪽 아래" 대각선을 축으로 하고, 대각선 왼쪽 아래로
 *  볼록/오른쪽 위로 볼록해지는 이 문서의 방향과 일치한다.)
 */

export const PALETTE = {
  hanji: '#efe6d2',
  ink: '#2a221b',
  boardBg: '#cdbd98',
  skyNight: '#141a2b',
  skyDusk1: '#50536c',
  skyDusk2: '#b98763',
  skyDawn1: '#ebb866',
  skyDawn2: '#f8ecd2',
  taegeukRed: '#c8312f',
  taegeukBlue: '#1f4e9a',
  dieBlack: '#1e1e1e',
  dieWhite: '#f7f5ef',
  dieRed: '#b8322c',
  dieBlue: '#2c4f8f'
};

const DIE_FACE = { black: PALETTE.dieBlack, white: PALETTE.dieWhite, red: PALETTE.dieRed, blue: PALETTE.dieBlue };
// 각 주사위 바탕색 위에서 또렷이 보이는 눈/점 색
const DIE_PIP = { black: PALETTE.dieWhite, white: PALETTE.ink, red: PALETTE.dieWhite, blue: PALETTE.dieWhite };

const SKY_STOPS = [PALETTE.skyNight, PALETTE.skyDusk1, PALETTE.skyDusk2, PALETTE.skyDawn1, PALETTE.skyDawn2];

/** 밤(0) → 새벽(1) 진행도에 따른 하늘 그라데이션 CSS 값 */
export function skyGradient(t) {
  // t: 0(밤) ~ 1(새벽). 다섯 정지점을 균등 배치.
  return 'linear-gradient(180deg, ' + SKY_STOPS.join(', ') + ')';
}

// ------------------------------------------------------------------
// 태극 (S자) — 표준 세로 공식을 만든 뒤 -45도 회전해 대각선 버전으로 만든다
// ------------------------------------------------------------------
function taegeukRedPath(cx, cy, r) {
  // 표준 공식(세로 지름 기준, 회전 전): 원 하나를 두 개의 점대칭(180도) 콤마꼴로 나눈다.
  // A r r 0 0 1 = 큰 반원(오른쪽으로 볼록), 이어 반지름 r/2 두 개로 S자를 완성.
  // (경험적으로 검증: 이 세 arc 조합이 빈틈 없이 맞물리는 정확한 태극 콤마 모양이다.)
  const top = `${cx} ${cy - r}`;
  const bot = `${cx} ${cy + r}`;
  return `M ${top} A ${r} ${r} 0 0 1 ${bot} A ${r / 2} ${r / 2} 0 0 1 ${cx} ${cy} A ${r / 2} ${r / 2} 0 0 0 ${top} Z`;
}

/**
 * 태극(원) SVG 조각 문자열을 반환한다 (그 자체로 <g>).
 * painted=false면 먹색 테두리만(도장 전 상태), true면 빨강/파랑 채색.
 *
 * 구성: "빨강" 콤마 하나를 정의한 뒤, "파랑"은 그 콤마를 중심점 기준 180도
 * 회전시킨 것(점대칭)으로 만든다 — 이렇게 해야 두 조각이 빈틈 없이 원을 채운다.
 * 전체를 rotate(-45)로 돌려 "왼쪽 위(건)→오른쪽 아래(곤)" 대각선이 S자의 기준
 * 지름이 되게 하면, 대각선 위쪽(오른쪽 위 삼각 영역)이 빨강, 아래쪽이 파랑이 된다.
 */
function taegeukGroup(cx, cy, r, painted) {
  const comma = taegeukRedPath(cx, cy, r);
  if (!painted) {
    return `<g transform="rotate(-45 ${cx} ${cy})">
      <path d="${comma}" fill="none" stroke="${PALETTE.ink}" stroke-width="${Math.max(1, r * 0.06)}"/>
      <g transform="rotate(180 ${cx} ${cy})"><path d="${comma}" fill="none" stroke="${PALETTE.ink}" stroke-width="${Math.max(1, r * 0.06)}"/></g>
    </g>`;
  }
  return `<g transform="rotate(-45 ${cx} ${cy})">
    <path d="${comma}" fill="${PALETTE.taegeukRed}"/>
    <g transform="rotate(180 ${cx} ${cy})"><path d="${comma}" fill="${PALETTE.taegeukBlue}"/></g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PALETTE.ink}" stroke-width="${Math.max(1, r * 0.04)}"/>
  </g>`;
}

/** 작은 태극 아이콘(기록지용). painted=false: 도장 찍히기 전(먹색 테두리만) */
export function taegeukIcon(size, painted) {
  const r = size / 2 - 1;
  const c = size / 2;
  return `<svg class="art-taegeuk" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    ${taegeukGroup(c, c, r, painted)}
  </svg>`;
}

// ------------------------------------------------------------------
// 괘(트라이그램) — 막대는 대각선(건-곤 대각선)에 수직으로 놓는다
// ------------------------------------------------------------------
// pattern: 위→아래 3개, true=양(solid), false=음(broken)
const TRIGRAM_PATTERN = {
  geon: [true, true, true],   // 건 ☰
  gon: [false, false, false], // 곤 ☷
  gam: [false, true, false],  // 감 ☵ (위 음, 가운데 양, 아래 음)
  ri: [true, false, true]     // 리 ☲ (위 양, 가운데 음, 아래 양)
};

/**
 * 괘 아이콘. 막대 3개가 스택 방향(대각선과 나란함)으로 쌓이고,
 * 각 막대 자신의 긴 방향은 대각선에 수직이다.
 * filled=false면 옅은(미획득) 표시, true면 먹색(획득) 표시.
 */
export function trigramIcon(key, size, filled) {
  const pattern = TRIGRAM_PATTERN[key] || TRIGRAM_PATTERN.geon;
  const c = size / 2;
  const barLen = size * 0.62;   // 막대(수직 방향) 길이
  const barThick = size * 0.12; // 막대 두께
  const gapMid = size * 0.10;   // 음(깨진 막대)의 가운데 틈
  const stackGap = size * 0.19; // 막대 사이 간격(대각선 방향)
  const color = filled ? PALETTE.ink : 'none';
  const strokeColor = filled ? PALETTE.ink : PALETTE.ink;
  const opacity = filled ? '1' : '0.28';
  // 회전 전 좌표계: 막대는 가로(길이=barLen, x방향), 3개가 세로(y방향)로 쌓임.
  // 이후 -45도 회전해 "막대는 대각선에 수직, 쌓임은 대각선과 나란"하게 만든다.
  const bars = pattern.map((solid, i) => {
    const y = c - stackGap - barThick / 2 + i * stackGap;
    if (solid) {
      const x = c - barLen / 2;
      return `<rect x="${x}" y="${y}" width="${barLen}" height="${barThick}" fill="${color}" stroke="${strokeColor}" stroke-width="${size * 0.03}"/>`;
    }
    const half = (barLen - gapMid) / 2;
    const x1 = c - barLen / 2;
    const x2 = c + gapMid / 2;
    return `<rect x="${x1}" y="${y}" width="${half}" height="${barThick}" fill="${color}" stroke="${strokeColor}" stroke-width="${size * 0.03}"/>` +
           `<rect x="${x2}" y="${y}" width="${half}" height="${barThick}" fill="${color}" stroke="${strokeColor}" stroke-width="${size * 0.03}"/>`;
  }).join('');
  return `<svg class="art-trigram" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity}">
    <g transform="rotate(-45 ${c} ${c})">${bars}</g>
  </svg>`;
}

const PIECE_TO_ART = { taegeuk: 'taegeuk', geon: 'geon', ri: 'ri', gam: 'gam', gon: 'gon' };
/** 조각 종류(taegeuk/geon/ri/gam/gon)에 맞는 작은 아이콘을 반환 */
export function pieceIcon(key, size, filled) {
  if (key === 'taegeuk') return taegeukIcon(size, filled);
  return trigramIcon(key, size, filled);
}

/** 완전한 태극기(3:2) — 장식용 큰 태극기 */
export function taegeukgiFlag(width) {
  const height = width * (2 / 3);
  const r = height / 4; // 지름 = 세로의 1/2 → 반지름 = 세로의 1/4
  const cx = width / 2, cy = height / 2;
  const trigramSize = height * 0.30;
  const margin = height * 0.12;
  const corner = (x, y, key) => `<g transform="translate(${x - trigramSize / 2} ${y - trigramSize / 2})">${trigramInner(key, trigramSize)}</g>`;
  return `<svg class="art-flag" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${PALETTE.hanji}" stroke="${PALETTE.ink}" stroke-width="${height * 0.015}"/>
    ${taegeukGroup(cx, cy, r, true)}
    ${corner(margin + trigramSize * 0.5, margin + trigramSize * 0.5, 'geon')}
    ${corner(width - margin - trigramSize * 0.5, height - margin - trigramSize * 0.5, 'gon')}
    ${corner(width - margin - trigramSize * 0.5, margin + trigramSize * 0.5, 'gam')}
    ${corner(margin + trigramSize * 0.5, height - margin - trigramSize * 0.5, 'ri')}
  </svg>`;
}
// taegeukgiFlag 안에서 <svg> 없이 괘 조각만 필요할 때 쓰는 내부 헬퍼
function trigramInner(key, size) {
  const full = trigramIcon(key, size, true);
  return full.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

// ------------------------------------------------------------------
// 주사위 (16×16 격자 느낌의 각진 아이콘). value: 1(감시의 눈) ~ 6
// ------------------------------------------------------------------
const PIP_LAYOUTS = {
  1: [], // eye로 별도 처리
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 2], [1, 3], [3, 1], [3, 2], [3, 3]]
};
/** 주사위 아이콘. value=1이면 눈 모양, 아니면 각진 점(픽셀풍) */
export function dieIcon(color, value, size, opts) {
  opts = opts || {};
  const face = DIE_FACE[color] || DIE_FACE.black;
  const pip = DIE_PIP[color] || PALETTE.ink;
  const eyeRing = value === 1;
  const grid = 4; // 4x4 셀 좌표계(눈금 1~3 사용, 0/4는 여백)
  const cell = size / grid;
  const r0 = size * 0.14; // 모서리 둥글기
  let inner;
  if (eyeRing) {
    // 감시의 눈: 아몬드형 눈 + 동공 (각진 픽셀풍)
    const cx = size / 2, cy = size / 2;
    const w = size * 0.62, h = size * 0.30;
    inner = `
      <path d="M ${cx - w / 2} ${cy} Q ${cx} ${cy - h} ${cx + w / 2} ${cy} Q ${cx} ${cy + h} ${cx - w / 2} ${cy} Z"
            fill="${pip}" stroke="${pip}" stroke-width="${size * 0.02}"/>
      <rect x="${cx - size * 0.07}" y="${cy - size * 0.07}" width="${size * 0.14}" height="${size * 0.14}" fill="${face}"/>`;
  } else {
    const pipSize = size * 0.15;
    inner = (PIP_LAYOUTS[value] || []).map(([gx, gy]) => {
      const x = gx * cell - pipSize / 2, y = gy * cell - pipSize / 2;
      return `<rect x="${x}" y="${y}" width="${pipSize}" height="${pipSize}" fill="${pip}"/>`;
    }).join('');
  }
  const sel = opts.selected ? `stroke="${PALETTE.taegeukRed}" stroke-width="${size * 0.06}"` : `stroke="${PALETTE.ink}" stroke-width="${size * 0.045}"`;
  return `<svg class="art-die" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="${size * 0.03}" y="${size * 0.03}" width="${size * 0.94}" height="${size * 0.94}" rx="${r0}" ry="${r0}" fill="${face}" ${sel}/>
    ${inner}
  </svg>`;
}

// ------------------------------------------------------------------
// 등잔 (켜짐 · 꺼짐)
// ------------------------------------------------------------------
/** 등잔 아이콘. lit=true면 켜짐(따뜻한 빛), false면 꺼짐(어두운 먹색) */
export function lanternIcon(size, lit) {
  const bodyColor = lit ? '#e8a53d' : '#5a5040';
  const flameColor = lit ? '#ffd873' : 'transparent';
  const strokeColor = PALETTE.ink;
  const w = size * 0.5, h = size * 0.62;
  const x = size / 2 - w / 2, y = size * 0.28;
  return `<svg class="art-lantern ${lit ? 'is-lit' : 'is-unlit'}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="${size / 2}" y1="${size * 0.06}" x2="${size / 2}" y2="${y}" stroke="${strokeColor}" stroke-width="${size * 0.04}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.28}" ry="${w * 0.28}" fill="${bodyColor}" stroke="${strokeColor}" stroke-width="${size * 0.045}"/>
    ${lit ? `<ellipse cx="${size / 2}" cy="${y + h / 2}" rx="${w * 0.22}" ry="${h * 0.28}" fill="${flameColor}"/>` : ''}
    <rect x="${x - size * 0.03}" y="${y + h}" width="${w + size * 0.06}" height="${size * 0.06}" fill="${strokeColor}"/>
  </svg>`;
}

// ------------------------------------------------------------------
// 연출: 도장 찍힘 / 흩어짐 효과 (짧은 CSS 애니메이션용 오버레이 마크업)
// ------------------------------------------------------------------
export function stampBurstMarkup() {
  return `<svg viewBox="0 0 40 40" class="fx-stamp" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="16" fill="none" stroke="${PALETTE.ink}" stroke-width="4"/>
  </svg>`;
}
export function scatterBurstMarkup() {
  const dots = [[6, 6], [34, 6], [6, 34], [34, 34], [20, 2], [2, 20], [38, 20], [20, 38]]
    .map(([x, y]) => `<rect x="${x - 2}" y="${y - 2}" width="4" height="4" fill="${PALETTE.ink}"/>`).join('');
  return `<svg viewBox="0 0 40 40" class="fx-scatter" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`;
}
