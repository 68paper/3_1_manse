/*
 * js/tutorial.js — 첫 걸음(하나로 이어지는 과정)
 * ------------------------------------------------------------------
 * 기획: docs/첫걸음_개편_시나리오.md
 *
 * 장면 하나에 개념 하나. 장면은 세 종류다.
 *   story : 이야기 카드를 넘긴다(장면 0 · 끝)
 *   dice  : 주사위를 눌러 사람과 밀정을 알아본다(장면 1)
 *   play  : 미리 짜 둔 판에서 코치 말풍선을 따라 직접 놓는다(장면 2 - 12)
 *
 * play 장면은 엔진(engine.js)을 그대로 쓴다. 여기서 더하는 것은
 *   - 시작 판(startBoard: 칸마다 색 · 눈)과 시작 기록지(startRecord)
 *   - 단계(steps): 말풍선 · 고를 주사위와 칸 · 퀴즈 · 틀렸을 때의 힌트
 * 뿐이다. 틀린 선택은 엔진에 넘기지 않고 막은 뒤 힌트를 준다.
 *
 * 단계 모양
 *   { say, next: true }                       [다음]을 누르면 넘어감
 *   { say, next: true, act: 'keepPlaced' }    [다음]을 누르면 방금 놓은 주사위를 남김(남기기를 배우기 전 장면)
 *   { say, sayPlace, move: { die, cell, quiz }, hints }
 *        die: [색, 눈] 또는 null(아무나), cell: 칸 번호 또는 null(놓을 수 있는 아무 칸)
 *        quiz: true면 처음엔 정답을 강조하지 않고, 두 번 틀리면 강조
 *   { say, keep: 칸 번호 | null, quiz, hints }
 *   { say, reward: 조각 | null, quiz, hints }  조각을 다 받을 때까지(교차 완성이면 두 모둠 모두)
 *   { say, order: true }                      교차 완성의 보상 순서 고르기
 *   hints: { die: { '색,눈': 문장 }, dieDefault, cell, invalid, keep, reward }
 *
 * 판 칸 번호
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */
import { Engine } from './engine.js';
import { SoloGame } from './solo.js';

const W = 'white', K = 'black', R = 'red', B = 'blue';

export const TUTORIAL_SCENES = [
  {
    id: 'night', num: 0, kind: 'story', title: '그날 밤', sub: '나는 조직가',
    cards: [
      '1919년 3월 1일을 앞둔 밤, 사람들은 각자의 자리에서 태극기를 준비했어요. 누가 시킨 일이 아니었어요.',
      '당신은 한 지방의 <b>조직가</b>예요. 밤마다 찾아오는 사람들에게 알맞은 자리를 찾아 주고, 뜻이 맞는 사람들을 모아 <b>태극기 조각</b>을 찍어요.'
    ],
    button: '시작하기'
  },
  {
    id: 'people', num: 1, kind: 'dice', title: '찾아온 사람들', sub: '색 · 눈 · 밀정',
    dice: [
      { color: W, value: 3, name: '마을 어른', group: '흰색 — 마을과 장터 사람들' },
      { color: K, value: 4, name: '인쇄공', group: '검정 — 도시의 일하는 사람들' },
      { color: R, value: 2, name: '여학생', group: '빨강 — 학생과 젊은이들' },
      { color: B, value: 5, name: '전도부인', group: '파랑 — 신앙의 사람들' },
      { color: K, value: 1, name: '밀정', group: '사람들 사이에 섞여 든 감시자', spy: true }
    ],
    summary: {
      dice: [[W, 3], [K, 4], [R, 2], [B, 5], [K, 1]],
      text: '흰 마을과 장터 · 검 도시의 일하는 사람들 · 빨 학생과 젊은이들 · 파 신앙의 사람들<br><b>1 = 밀정</b>, 어떤 모둠에도 들어갈 수 없어요.'
    }
  },
  {
    id: 'place', num: 2, kind: 'play', title: '자리 찾아 주기', sub: '두 번 고르고 놓기',
    nights: 1, seed: 1902,
    scriptedPools: [[[R, 2], [K, 3], [W, 4], [B, 5]]],
    steps: [
      { say: '밤이 되면 사람들이 <b>광장</b>에 모여요. 한 사람을 골라 보세요.',
        sayPlace: '판이 비어 있으면 <b>어느 칸에든</b> 놓을 수 있어요.',
        move: { die: null, cell: null } },
      { say: '한 사람 더 맞이해요. 이번엔 놓을 수 있는 칸이 정해져 있어요.',
        sayPlace: '이미 놓인 사람의 <b>상하좌우 빈칸</b>에만 놓을 수 있어요.',
        move: { die: null, cell: null },
        hints: { invalid: '대각선은 안 돼요. 이미 있는 사람 바로 옆(상하좌우)에 세워 주세요.' } },
      { say: '한 밤에 맞이하는 사람은 둘이에요. 남은 사람들은 <b>주머니</b>로 돌아가요.', next: true },
      { say: '한 번 데려온 사람은 <b>반드시</b> 놓아야 해요. 찾아온 사람을 돌려보내지 않아요.', next: true }
    ],
    summary: { text: '한 밤 = 고르고 놓기 × 2<br>상하좌우 빈칸에만(대각선은 안 돼요)<br>데려온 사람은 꼭 놓기' }
  },
  {
    id: 'hand', num: 3, kind: 'play', title: '한동네', sub: '같은 색 · 다른 눈',
    nights: 1, seed: 1903,
    startBoard: { 0: [W, 2], 1: [W, 5] },
    scriptedPools: [[[W, 6], [K, 3], [R, 4], [B, 2]]],
    steps: [
      { say: '윗줄에 마을 사람 둘이 서 있어요. 같은 <b>흰색</b>이죠.', next: true },
      { say: '같은 마을 사람을 한 명 더 데려와 볼까요? 반짝이는 사람을 골라요.',
        sayPlace: '윗줄 빈칸에 세워 주세요.',
        move: { die: [W, 6], cell: 2 },
        hints: { dieDefault: '윗줄은 흰색 사람들이에요. 같은 색을 찾아보세요.', cell: '윗줄 빈칸(반짝이는 칸)에 세워 주세요.' } },
      { say: '<b>한동네!</b> 색이 모두 같고 눈이 모두 다르면 한동네예요.', next: true, act: 'keepPlaced' },
      { say: '모둠은 한 사람만 남고 나머지는 주머니로 돌아가요. 누구를 남길지는 뒤에서 배워요.', next: true },
      { say: '한동네는 <b>태극기 조각 1개</b>를 찍어요. 태극 · 건 · 리 · 감 · 곤 중 무엇이든 골라요.', reward: null },
      { say: '한 사람 더 맞이하고 이 밤을 마쳐요.', move: { die: null, cell: null } }
    ],
    summary: { dice: [[W, 2], [W, 5], [W, 6]], text: '<b>한동네</b>: 같은 색 · 다른 눈(이어지지 않음) → 조각 1개' }
  },
  {
    id: 'link', num: 4, kind: 'play', title: '연락망', sub: '같은 색 · 이어진 눈',
    nights: 1, seed: 1904,
    startBoard: { 3: [B, 5], 5: [B, 3] },
    scriptedPools: [[[B, 4], [B, 6], [W, 4], [K, 2]]],
    steps: [
      { say: '가운데 줄에 파랑 5와 파랑 3이 있어요. 둘 사이에 누가 서면 뜻이 이어질까요? 골라 보세요.',
        sayPlace: '맞아요! 가운데 빈칸에 세워 주세요.',
        move: { die: [B, 4], cell: 4, quiz: true },
        hints: {
          die: {
            'blue,6': '같은 파랑이지만 5 · 6 · 3은 이어지지 않아요. 3과 5 사이의 눈은?',
            'white,4': '눈은 맞았어요! 그런데 연락망은 색도 같아야 해요.',
            'black,2': '색도 눈도 이어지지 않아요. 3과 5 사이의 파랑을 찾아보세요.'
          },
          cell: '파랑 5와 파랑 3 사이(반짝이는 칸)에 세워 주세요.'
        } },
      { say: '<b>연락망!</b> 색이 같고 눈이 <b>이어지면</b> 연락망이에요. 5 · 4 · 3처럼 순서가 뒤섞여도 괜찮아요.', next: true, act: 'keepPlaced' },
      { say: '파랑 4가 남았어요. 연락망은 조각 <b>2개</b>를 찍어요.', reward: null },
      { say: '한 사람 더 맞이하고 이 밤을 마쳐요.', move: { die: null, cell: null } }
    ],
    summary: { dice: [[B, 3], [B, 4], [B, 5]], text: '<b>연락망</b>: 같은 색 · 이어진 눈(2·3·4 / 3·4·5 / 4·5·6) → 조각 2개<br>같은 색이고 이어지면 연락망만 받아요(한동네와 겹쳐 받지 않음).' }
  },
  {
    id: 'one', num: 5, kind: 'play', title: '한뜻', sub: '같은 눈 · 다른 색',
    nights: 1, seed: 1905,
    startBoard: { 1: [R, 4], 4: [K, 4] },
    scriptedPools: [[[W, 4], [R, 4], [B, 6], [K, 2]]],
    steps: [
      { say: '학생(빨강)과 도시의 일꾼(검정)이 같은 눈 4로 서 있어요. 처지는 달라도 뜻은 같아요.', next: true },
      { say: '이 세로줄을 <b>한뜻</b>으로 만들 사람을 골라 보세요.',
        sayPlace: '아래 칸에 세워 주세요.',
        move: { die: [W, 4], cell: 7, quiz: true },
        hints: {
          die: { 'red,4': '눈은 같지만 빨강이 이미 있어요. 한뜻은 색이 모두 달라야 해요.' },
          dieDefault: '한뜻은 눈이 같아야 해요. 이 줄의 눈은 몇이죠?',
          cell: '세로줄 아래 칸(반짝이는 칸)에 세워 주세요.'
        } },
      { say: '<b>한뜻!</b> 눈이 모두 같고 색이 <b>모두 달라야</b> 한뜻이에요.', next: true, act: 'keepPlaced' },
      { say: '한뜻은 조각 <b>2개</b>를 찍어요. 그리고 숨은 힘이 하나 더 있는데, 곧 알게 될 거예요.', reward: null },
      { say: '한 사람 더 맞이하고 이 밤을 마쳐요.', move: { die: null, cell: null } }
    ],
    summary: { dice: [[R, 4], [K, 4], [W, 4]], text: '<b>한뜻</b>: 같은 눈 · 다른 색 → 조각 2개 + 밀정 쫓아내기' }
  },
  {
    id: 'keep', num: 6, kind: 'play', title: '한 사람 남기기', sub: '다음 모둠의 씨앗',
    nights: 1, seed: 1906,
    startBoard: { 0: [R, 3], 2: [R, 5], 4: [K, 4] },
    scriptedPools: [[[R, 4], [W, 4], [B, 2], [K, 6]]],
    steps: [
      { say: '윗줄에 빨강 3과 5. 무엇이 필요한지 이제 알죠?',
        sayPlace: '윗줄 가운데에 세워 주세요.',
        move: { die: [R, 4], cell: 1 },
        hints: { dieDefault: '빨강 3과 5 사이에 설 빨강을 찾아보세요.', cell: '윗줄 가운데(반짝이는 칸)에 세워 주세요.' } },
      { say: '<b>연락망!</b> 이번에는 <b>누구를 남길지 직접</b> 골라요. 남은 사람은 다음 모둠의 씨앗이 돼요. 아래의 검정 4를 보세요.',
        keep: 1, quiz: true,
        hints: { keep: '그 사람을 남기면 가운데 세로줄이 비어요. 아래 검정 4와 이어질 사람은 누구일까요?' } },
      { say: '좋아요! 빨강 4가 검정 4 위에 남았어요. 조각 2개를 골라요.', reward: null },
      { say: '이제 광장을 보세요. 가운데 세로줄을 한뜻으로 만들 사람이 있어요.',
        sayPlace: '맨 아래 칸에 세워 주세요.',
        move: { die: [W, 4], cell: 7, quiz: true },
        hints: { dieDefault: '가운데 세로줄은 빨강 4 · 검정 4예요. 눈이 4이면서 색이 다른 사람은?', cell: '세로줄 맨 아래(반짝이는 칸)에 세워 주세요.' } },
      { say: '<b>한뜻!</b> 이번엔 남길 사람을 마음대로 골라 보세요.', keep: null },
      { say: '조각 2개를 골라요. 한 사람을 잘 남기면 모둠이 줄줄이 이어져요.', reward: null }
    ],
    summary: { text: '모둠 → 한 사람 남기고 둘은 주머니로<br>남긴 사람이 다음 모둠의 씨앗이에요.' }
  },
  {
    id: 'scatter', num: 7, kind: 'play', title: '꽉 차면 흩어진다', sub: '모둠이 아니면 사라짐',
    nights: 1, seed: 1907,
    startBoard: { 6: [W, 2], 7: [K, 5] },
    scriptedPools: [[[R, 6], [B, 3], [W, 4], [K, 2]]],
    steps: [
      { say: '아랫줄에 마을 사람(흰2)과 도시 사람(검5)이 서 있어요. 색도 눈도 달라요.', next: true },
      { say: '빨강 6을 아랫줄 끝에 세우면 어떻게 될까요? 반짝이는 사람을 골라요.',
        sayPlace: '아랫줄 오른쪽 끝에 세워 주세요.',
        move: { die: [R, 6], cell: 8 },
        hints: { dieDefault: '반짝이는 빨강 6을 골라 주세요.', cell: '아랫줄 오른쪽 끝(반짝이는 칸)에 세워 주세요.' } },
      { say: '흰2 · 검5 · 빨6 — 한동네도, 연락망도, 한뜻도 아니에요. 줄이 꽉 찼는데 모둠이 아니면 <b>흩어져요</b>. 셋 모두 주머니로 돌아갔어요.', next: true },
      { say: '판이 비었으니 다시 <b>어디든</b> 놓을 수 있어요. 한 사람 더 맞이해요.', move: { die: null, cell: null } },
      { say: '줄을 닫는 마지막 한 사람은 신중하게! 모둠이 될 때만 줄을 채우세요.', next: true }
    ],
    summary: {
      text: '꽉 찬 줄 → 모둠이면 보상, 모둠이 아니면 <b>흩어짐</b>(모두 주머니로)',
      extra: {
        title: '더 알아두기 — 남긴 사람이 걸친 다른 줄',
        boards: [
          { caption: '오른쪽 위에 파4를 놓으면 세로줄은 연락망, 윗줄은 꽉 찼지만 모둠이 아니에요.', board: { 0: [W, 2], 1: [K, 5], 2: [B, 4], 5: [B, 5], 8: [B, 6] } },
          { caption: '파4를 남기면 윗줄이 꽉 찬 채로 남아 흩어지고, 남긴 파4도 함께 돌아가요.', board: {} },
          { caption: '파5나 파6을 남기면 오른쪽 위 칸이 비어 윗줄은 그대로 남아요.', board: { 0: [W, 2], 1: [K, 5], 8: [B, 6] } }
        ]
      }
    }
  },
  {
    id: 'spy', num: 8, kind: 'play', title: '밀정', sub: '남는 밀정, 쫓아내기',
    nights: 2, seed: 1908,
    startBoard: { 0: [B, 2], 2: [B, 3] },
    scriptedPools: [
      [[B, 1], [W, 1], [R, 3], [K, 6]],
      [[W, 3], [B, 3], [W, 1], [K, 6]]
    ],
    steps: [
      { say: '오늘 밤 광장에 밀정이 섞여 들었어요. 그래도 찾아온 사람은 맞이해야 해요. 반짝이는 파랑 밀정을 골라요.',
        sayPlace: '윗줄 가운데에 세워 보세요. 파랑 1 · 2 · 3, 이어지는 것 같죠?',
        move: { die: [B, 1], cell: 1 },
        hints: { dieDefault: '반짝이는 파랑 밀정을 골라 주세요.', cell: '윗줄 가운데(반짝이는 칸)에 세워 주세요.' } },
      { say: '하지만 1은 밀정이에요. <b>밀정이 있는 줄은 모둠이 될 수 없어요.</b> 그래서 흩어졌는데, 보세요 — <b>밀정은 그대로 남았어요.</b>', next: true },
      { say: '밀정 아래에 학생을 세워 두죠. 다음 밤에 쓸 거예요.',
        sayPlace: '밀정 바로 아래 칸에 세워 주세요.',
        move: { die: [R, 3], cell: 4 },
        hints: { dieDefault: '반짝이는 빨강 3을 골라 주세요.', cell: '밀정 바로 아래(반짝이는 칸)에 세워 주세요.' } },
      { say: '둘째 밤이에요. 가운데 가로줄로 <b>한뜻</b>을 만들어 밀정을 몰아내 봐요.', next: true },
      { say: '먼저 흰색 3을 골라요.', sayPlace: '빨강 3의 왼쪽에 세워 주세요.',
        move: { die: [W, 3], cell: 3 },
        hints: { dieDefault: '반짝이는 흰색 3을 골라 주세요.', cell: '빨강 3의 왼쪽(반짝이는 칸)에 세워 주세요.' } },
      { say: '이번엔 파랑 3이에요.', sayPlace: '빨강 3의 오른쪽에 세워 주세요.',
        move: { die: [B, 3], cell: 5 },
        hints: { dieDefault: '반짝이는 파랑 3을 골라 주세요.', cell: '빨강 3의 오른쪽(반짝이는 칸)에 세워 주세요.' } },
      { say: '<b>한뜻!</b> 한 사람을 남겨요.', keep: null },
      { say: '이제 한뜻의 숨은 힘! 판에 있던 <b>밀정이 쫓겨났어요</b>. 줄에 없어도 쫓아낼 수 있어요. +1점이에요.', next: true },
      { say: '그리고 조각 2개도 받아요. 모두 3점이에요.', reward: null }
    ],
    summary: { text: '밀정이 있는 줄은 모둠이 될 수 없어요.<br>흩어지면 <b>밀정만 남아요</b>.<br>한뜻 = 밀정 하나 쫓아내기(+1) + 조각 2개' }
  },
  {
    id: 'withdraw', num: 9, kind: 'play', title: '감시 철수', sub: '밀정 셋은 모두 떠남',
    nights: 1, seed: 1909,
    startBoard: { 3: [K, 1], 5: [W, 1] },
    scriptedPools: [[[R, 1], [B, 1], [W, 1], [K, 1]]],
    steps: [
      { say: '이런, 오늘 밤 광장엔 밀정뿐이에요. 그래도 둘은 맞이해야 해요. 아무 밀정이나 골라요.',
        sayPlace: '밀정 둘 사이에 세워 보세요.',
        move: { die: null, cell: 4 },
        hints: { cell: '밀정 둘 사이(반짝이는 칸)에 세워 주세요.' } },
      { say: '지켜볼 사람이 없으니 밀정도 흩어져요. <b>감시 철수!</b> 감시 철수로 빠진 밀정에는 <b>점수가 없어요</b>. 쫓아낸 게 아니라 스스로 떠난 거예요.', next: true },
      { say: '남은 밀정도 하나 맞이해야 해요. 빈 판 어디에 둘까요?', move: { die: null, cell: null } }
    ],
    summary: { text: '처리 순서 ① 모둠 → ② 흩어짐(밀정만 남음) → ③ <b>감시 철수</b>(밀정 셋 줄은 모두 사라짐, 점수 없음)' }
  },
  {
    id: 'cross', num: 10, kind: 'play', title: '교차 완성', sub: '하나로 두 모둠',
    nights: 1, seed: 1910,
    startBoard: { 0: [B, 4], 1: [B, 5], 5: [K, 6], 6: [W, 1], 8: [R, 6] },
    scriptedPools: [[[B, 6], [W, 6], [K, 3], [R, 5]]],
    steps: [
      { say: '윗줄과 오른쪽 세로줄을 잘 보세요. 둘 다 한 칸씩 비어 있고, 빈칸이 <b>같은 칸</b>이에요.', next: true },
      { say: '두 줄을 한꺼번에 모둠으로 만들 사람을 찾아보세요.',
        sayPlace: '오른쪽 위 모서리에 세워 주세요.',
        move: { die: [B, 6], cell: 2, quiz: true },
        hints: {
          die: { 'white,6': '세로줄은 한뜻이 되지만, 윗줄 파4 · 파5 · 흰6은 흩어져요. 두 줄 다 살릴 사람은?' },
          dieDefault: '두 줄 모두에 맞는 사람이 있어요. 윗줄은 파랑, 세로줄은 눈 6이에요.',
          cell: '오른쪽 위 모서리(반짝이는 칸)에 세워 주세요.'
        } },
      { say: '<b>교차 완성!</b> 가로는 연락망, 세로는 한뜻이에요. 두 줄이 겹치는 파랑 6이 남고 나머지 넷은 돌아갔어요.', next: true },
      { say: '보상은 <b>둘 다</b> 받아요. 어느 것부터 받을지 골라요.', order: true },
      { say: '한뜻은 판의 밀정을 쫓아내고(+1) 조각 2개, 연락망은 조각 2개예요. 조각을 골라요.', reward: null },
      { say: '모두 5점! 한 사람 더 맞이하고 이 밤을 마쳐요.', move: { die: null, cell: null } }
    ],
    summary: { text: '<b>교차 완성</b> — 놓은 사람이 남아요.<br>두 모둠 보상을 모두 받고, 받는 순서는 직접 정해요.' }
  },
  {
    id: 'flag', num: 11, kind: 'play', title: '태극기 완성', sub: '다섯 조각 = +1',
    nights: 1, seed: 1911,
    startBoard: { 6: [K, 2], 7: [K, 4] },
    startRecord: { taegeuk: 1, geon: 1, ri: 1, gam: 1 },
    scriptedPools: [[[K, 6], [K, 3], [W, 5], [R, 2]]],
    steps: [
      { say: '아래 기록지가 지금까지 모은 조각이에요(4점). 1번 태극기에 한 자리만 비어 있어요 — <b>곤</b> 자리예요.', next: true },
      { say: '아랫줄을 모둠으로 만들어 조각을 받아요. 반짝이는 사람을 골라요.',
        sayPlace: '아랫줄 끝에 세워 주세요.',
        move: { die: [K, 6], cell: 8 },
        hints: { dieDefault: '반짝이는 검정 6을 골라 주세요.', cell: '아랫줄 끝(반짝이는 칸)에 세워 주세요.' } },
      { say: '<b>한동네!</b> 검2 · 검4 · 검6, 같은 색에 다른 눈이에요.', next: true, act: 'keepPlaced' },
      { say: '한동네는 조각 1개. 1번 태극기에 비어 있는 자리를 채워 볼까요?',
        reward: 'gon', quiz: true,
        hints: { reward: '그 조각은 이미 찍혀 있어요. 1번 태극기에 비어 있는 자리를 골라 보세요.' } },
      { say: '다섯 자리가 모두 찍히면 <b>태극기 한 장 완성</b>, 1점을 더 받아요. 점수 = 조각 수 + 완성한 태극기 + 쫓아낸 밀정 → 5 + 1 + 0 = <b>6점</b>.', next: true },
      { say: '한 사람 더 맞이하고 이 밤을 마쳐요.', move: { die: null, cell: null } }
    ],
    summary: { text: '조각 1개 = 1점 · 태극기 한 장 = +1점 · 밀정 쫓아냄 = +1점' }
  },
  {
    id: 'free', num: 12, kind: 'play', title: '첫 밤길', sub: '안내 없이 세 밤',
    nights: 3, seed: 386, poolSize: 4,
    goal: { combos: 2, score: 5 },
    steps: [
      { say: '이제 안내 없이 세 밤을 보내요. 목표는 <b>모둠 2개</b> 또는 <b>5점</b>이에요. 지금까지 배운 것을 써 보세요.', next: true }
    ]
  },
  {
    id: 'end', num: null, kind: 'story', title: '3월 1일 아침', sub: '마침',
    cards: [
      '등잔이 꺼지고 날이 밝았어요. 여덟 밤을 보낼 준비가 끝났어요. 이제 진짜 밤이 기다려요.',
      '<b>스무하루의 밤</b> — 이야기와 함께 스물한 밤을 버텨요.<br><b>단속의 밤</b> — 낮의 단속을 피해 태극기를 지켜요.<br><b>자유 연습</b> — 친구나 AI와 여덟 밤을 겨뤄요.'
    ],
    button: '첫 걸음 마치기',
    flag: true
  }
];

const WAIT_NEXT = '말풍선을 읽고 [다음]을 눌러 주세요.';

function dieKey(d) { return d.color + ',' + d.value; }
function sameDie(d, spec) { return !!d && d.color === spec[0] && d.value === spec[1]; }

/**
 * TutorialGame — play 장면 하나. SoloGame을 그대로 쓰고, 행동마다 지금 단계에 맞는지 먼저 본다.
 * 맞지 않으면 엔진에 넘기지 않고 hint(말풍선 아래 힌트) · shake(흔들 대상)만 남긴다.
 */
export class TutorialGame extends SoloGame {
  constructor(scene) {
    super(scene, 'tutorial', {});
    this.scene = scene;
    this.stepIndex = 0;
    this.wrong = 0;    // 지금 단계에서 틀린 횟수(두 번이면 정답 강조)
    this.hint = null;  // 지금 보여 줄 힌트
    this.shake = null; // { kind: 'die' | 'cell' | 'reward', id }
  }

  _buildAndStart() {
    const scene = this.level;
    const g = Engine.create({
      n: 1, types: ['human'], seed: scene.seed, ruleMode: 'basic',
      maxRounds: scene.nights || 1, poolSize: scene.poolSize || 4,
      eyeChance: null, scriptedPools: scene.scriptedPools || null
    });
    const p = g.players[0];
    const board = scene.startBoard || {};
    Object.keys(board).forEach(function (cell) {
      const spec = board[cell];
      p.board[Number(cell)] = { color: spec[0], value: spec[1] };
      g.bag[spec[0]]--;
    });
    if (scene.startRecord) Object.assign(p.parts, scene.startRecord);
    p.score = Engine.scoreOf(p);
    Engine.startRound(g);
    this.g = g;
    this.selectedPi = null;
  }

  get step() { return (this.scene.steps || [])[this.stepIndex] || null; }
  /** 단계를 모두 지났고 판도 끝났으면 장면 끝 */
  get finished() { return this.g.done && !this.step; }
  get sceneCombos() { const s = this.player.stats; return s.same + s.consec + s.color; }
  /** 첫 밤길(장면 12)의 목표 */
  get goalMet() {
    const goal = this.scene.goal;
    return !!goal && (this.sceneCombos >= goal.combos || this.score >= goal.score);
  }

  _reveal(step) {
    const quiz = step.quiz || (step.move && step.move.quiz);
    return !quiz || this.wrong >= 2;
  }
  _advance() { this.stepIndex++; this.wrong = 0; this.hint = null; }
  _reject(hint, shake) { this.wrong++; this.hint = hint; this.shake = shake || null; return false; }

  /** 말풍선: 장면 이름 · 지금 할 말 · 힌트 · [다음] 여부 */
  coach() {
    const step = this.step;
    let text = '';
    if (step) text = (step.move && this.selectedPi != null && step.sayPlace) ? step.sayPlace : step.say;
    return { text: text, hint: this.hint, canNext: !!(step && step.next) };
  }

  /** 화면에서 강조할 것. locked면 강조된 주사위 말고는 흐리게 */
  targets() {
    const t = { dice: [], cells: [], keep: [], rewards: [], locked: false };
    const step = this.step;
    if (!step) return t;
    const reveal = this._reveal(step);
    if (step.move) {
      if (this.selectedPi == null) {
        if (step.move.die && reveal) {
          const spec = step.move.die;
          this.pool.forEach(function (d, i) { if (sameDie(d, spec)) t.dice.push(i); });
          t.locked = true;
        }
      } else if (step.move.cell != null && reveal) {
        t.cells.push(step.move.cell);
      }
    }
    if (step.keep != null && reveal) t.keep.push(step.keep);
    if (step.reward && reveal) t.rewards.push(step.reward);
    return t;
  }

  /** 모둠 순서 · 조각 고르기 창을 지금 띄워도 되는지(설명하는 동안은 숨김) */
  overlayAllowed() {
    const step = this.step;
    if (!step) return true;
    if (this.g.phase === 'combo_reward') return step.reward !== undefined;
    if (this.g.phase === 'combo_order') return !!step.order;
    return false;
  }

  next() {
    const step = this.step;
    if (!step || !step.next) return false;
    if (step.act === 'keepPlaced' && this.g.phase === 'combo_keep') {
      super.chooseKeep(this.g.pending.placedCell);
    }
    this._advance();
    return true;
  }

  selectDie(pi) {
    const step = this.step;
    if (step && !step.move) return this._reject(step.next ? WAIT_NEXT : null);
    if (step && step.move.die && this.selectedPi !== pi) {
      const d = this.pool[pi];
      if (!sameDie(d, step.move.die)) {
        const h = step.hints || {};
        return this._reject((h.die && h.die[dieKey(d)]) || h.dieDefault || '반짝이는 사람을 골라 주세요.', { kind: 'die', id: pi });
      }
    }
    this.hint = null;
    return super.selectDie(pi);
  }

  placeAt(cell) {
    const step = this.step;
    if (this.g.phase !== 'place' || this.selectedPi == null) return false;
    if (step) {
      const h = step.hints || {};
      if (this.validCells().indexOf(cell) < 0) {
        return this._reject(h.invalid || '이미 놓인 사람 바로 옆(상하좌우) 빈칸에만 놓을 수 있어요. 대각선은 안 돼요.', { kind: 'cell', id: cell });
      }
      if (step.move.cell != null && cell !== step.move.cell) {
        return this._reject(h.cell || '반짝이는 칸에 세워 주세요.', { kind: 'cell', id: cell });
      }
    }
    const ok = super.placeAt(cell);
    if (ok && step) this._advance();
    return ok;
  }

  chooseKeep(cell) {
    const step = this.step;
    if (step) {
      if (step.keep === undefined) return this._reject(step.next ? WAIT_NEXT : null);
      if (step.keep != null && cell !== step.keep) {
        return this._reject((step.hints && step.hints.keep) || '반짝이는 사람을 남겨 주세요.', { kind: 'cell', id: cell });
      }
    }
    const ok = super.chooseKeep(cell);
    if (ok && step) this._advance();
    return ok;
  }

  chooseReward(key) {
    const step = this.step;
    if (step) {
      if (step.reward === undefined) return this._reject(step.next ? WAIT_NEXT : null);
      if (step.reward && key !== step.reward) {
        return this._reject((step.hints && step.hints.reward) || '반짝이는 조각을 골라 주세요.', { kind: 'reward', id: key });
      }
    }
    const ok = super.chooseReward(key);
    if (ok) this.hint = null;
    if (ok && step && this.g.phase !== 'combo_reward') this._advance();
    return ok;
  }

  chooseComboOrder(idx) {
    const step = this.step;
    if (step && !step.order) return this._reject(step.next ? WAIT_NEXT : null);
    const ok = super.chooseComboOrder(idx);
    if (ok && step) this._advance();
    return ok;
  }

  /** 지금 장면이 첫 밤길처럼 안내 없이 두는 중인지 */
  get freePlay() { return !this.step && !this.g.done; }
}
