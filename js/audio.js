/*
 * js/audio.js — 배경음 · 효과음
 * ------------------------------------------------------------------
 * 외부 음원 파일 없이 Web Audio API로 소리를 직접 합성한다.
 *   - 배경음: 라단조(D minor) 3/4박자 왈츠, 96BPM, 16마디(약 30초) 반복.
 *     첫 박의 낮은 베이스 + 둘째·셋째 박의 화음(쿵-짝-짝) 위에 무거운 선율.
 *     한 바퀴는 선율을 위 음역에서, 다음 바퀴는 한 옥타브 아래 낮은 소리로 번갈아 연주.
 *   - 효과음: 대고(쿵) · 북 테두리(딱) · 징 · 호각 · 군중 함성을 조합해 행동마다 다른 장단을 친다.
 *     휴대폰 스피커에서도 북이 힘 있게 들리도록 펀치 대역 보강 · 찌그러뜨림 · 여럿이 겹쳐 치기를 쓰고,
 *     효과음이 울리는 동안에는 배경음을 잠깐 낮춘다(ducking).
 *
 * 브라우저 자동재생 정책 때문에 AudioContext는 첫 터치/클릭 때 만든다(unlock).
 */

const BPM = 96;
const BEAT = 60 / BPM;
const BAR = BEAT * 3;

// 마디별 화음: 베이스 근음(MIDI) + 둘째·셋째 박 화음 구성음
const CHORDS = {
  Dm: { bass: 38, tones: [57, 62, 65] },
  Bb: { bass: 34, tones: [58, 62, 65] },
  Gm: { bass: 43, tones: [55, 58, 62] },
  A: { bass: 45, tones: [57, 61, 64] },
  F: { bass: 41, tones: [57, 60, 65] }
};
const PROGRESSION = [
  'Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A',
  'Dm', 'F', 'Gm', 'Dm', 'Bb', 'Gm', 'A', 'Dm'
];
// 마디별 선율: [MIDI, 박 수] — 각 마디 합 3박
const MELODY = [
  [[69, 2], [65, 1]], [[74, 2], [72, 1]], [[70, 2], [69, 1]], [[65, 3]],
  [[67, 1], [70, 1], [74, 1]], [[72, 2], [70, 1]], [[69, 2], [67, 1]], [[64, 2], [69, 1]],
  [[74, 2], [77, 1]], [[72, 2], [69, 1]], [[70, 2], [74, 1]], [[69, 3]],
  [[70, 1], [69, 1], [67, 1]], [[65, 1], [67, 1], [70, 1]], [[69, 2], [73, 1]], [[74, 3]]
];

let ctx = null;
let master = null, bgmBus = null, duckGain = null, sfxBus = null, drumBus = null, reverb = null, hall = null;
let noiseBuf = null;
let bgmEnabled = true, sfxEnabled = true;
let bgmTimer = null, nextBarTime = 0, barIndex = 0;
// 효과음 '목소리': play() 한 번이 만드는 소리 묶음의 출력(북 · 기타 · 잔향). 소리 함수들은 여기로 보낸다.
let vDrum = null, vSfx = null, vHall = null;
let voices = []; // { gains, prio, made(만든 시각), end }

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function makeImpulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function makeNoise() {
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
  // 여러 소리가 겹쳐도 찢어지지 않도록 마지막에 리미터
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);

  // 배경음용 잔향
  reverb = ctx.createConvolver(); reverb.buffer = makeImpulse(2.4, 3);
  const wet = ctx.createGain(); wet.gain.value = 0.28;
  reverb.connect(wet); wet.connect(master);

  // 효과음용 넓은 잔향(광장에 울리는 느낌)
  hall = ctx.createConvolver(); hall.buffer = makeImpulse(3.4, 2.5);
  const hallWet = ctx.createGain(); hallWet.gain.value = 0.35;
  hall.connect(hallWet); hallWet.connect(master);

  // 배경음: bgmBus(켜고 끄기) → duckGain(효과음 때 잠깐 낮추기)
  bgmBus = ctx.createGain(); bgmBus.gain.value = bgmEnabled ? 0.55 : 0;
  duckGain = ctx.createGain(); duckGain.gain.value = 1;
  bgmBus.connect(duckGain); duckGain.connect(master); duckGain.connect(reverb);

  sfxBus = ctx.createGain(); sfxBus.gain.value = 1;
  sfxBus.connect(master); sfxBus.connect(hall);

  // 북 전용: 부드러운 찌그러뜨림으로 배음을 만들어 작은 스피커에서도 '쿵'이 들리게
  drumBus = ctx.createGain(); drumBus.gain.value = 0.8;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = i / (curve.length - 1) * 2 - 1;
    curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
  }
  shaper.curve = curve; shaper.oversample = '2x';
  const drumOut = ctx.createGain(); drumOut.gain.value = 0.75;
  drumBus.connect(shaper); shaper.connect(drumOut); drumOut.connect(sfxBus);

  noiseBuf = makeNoise();
  return ctx;
}

// ------------------------------------------------------------------
// 배경음
// ------------------------------------------------------------------
function tone(dest, midi, t, dur, opts) {
  const o = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = opts.type || 'triangle';
  o.frequency.setValueAtTime(midiHz(midi), t);
  if (opts.vibrato) {
    const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    lfo.frequency.value = 5; lg.gain.value = midiHz(midi) * 0.006;
    lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(t + 0.15); lfo.stop(t + dur + 0.6);
  }
  f.type = 'lowpass'; f.frequency.value = opts.cutoff || 1800; f.Q.value = 0.7;
  const peak = opts.gain || 0.2;
  const atk = opts.attack || 0.02;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + atk);
  g.gain.setTargetAtTime(peak * (opts.sustain != null ? opts.sustain : 0.6), t + atk, 0.15);
  g.gain.setTargetAtTime(0.0001, t + dur, opts.release || 0.18);
  o.connect(f); f.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 1.2);
}

function scheduleBar(t, idx) {
  const bar = idx % PROGRESSION.length;
  const lowPass = Math.floor(idx / PROGRESSION.length) % 2 === 1;
  const ch = CHORDS[PROGRESSION[bar]];

  // 첫 박: 낮은 베이스 + 은은한 북
  tone(bgmBus, ch.bass, t, BEAT * 1.6, { type: 'sawtooth', cutoff: 380, gain: 0.32, attack: 0.01, sustain: 0.45, release: 0.25 });
  tone(bgmBus, ch.bass + 12, t, BEAT * 1.2, { type: 'triangle', cutoff: 600, gain: 0.12, attack: 0.01, sustain: 0.4 });
  bgmDrum(bgmBus, t, { freq: 58, gain: 0.35, decay: 0.45, slap: 0.04 });

  // 둘째·셋째 박: 화음(짝, 짝)
  for (let b = 1; b <= 2; b++) {
    ch.tones.forEach(function (m) {
      tone(bgmBus, m, t + BEAT * b, BEAT * 0.55, { type: 'triangle', cutoff: 1100, gain: 0.05, attack: 0.015, sustain: 0.35, release: 0.12 });
    });
  }
  if (bar % 4 === 3) rimHit(bgmBus, t + BEAT * 2, 0.05);

  // 선율: 짝수 바퀴는 원래 음역(여린 목관 느낌), 홀수 바퀴는 한 옥타브 아래(첼로 느낌)
  let beatPos = 0;
  MELODY[bar].forEach(function (n) {
    const dur = n[1] * BEAT;
    if (lowPass) {
      tone(bgmBus, n[0] - 12, t + beatPos * BEAT, dur * 0.95, { type: 'sawtooth', cutoff: 900, gain: 0.11, attack: 0.08, sustain: 0.8, release: 0.25, vibrato: true });
    } else {
      tone(bgmBus, n[0], t + beatPos * BEAT, dur * 0.92, { type: 'triangle', cutoff: 2200, gain: 0.16, attack: 0.05, sustain: 0.75, release: 0.22, vibrato: true });
    }
    beatPos += n[1];
  });
}

function bgmTick() {
  while (nextBarTime < ctx.currentTime + 0.4) {
    scheduleBar(nextBarTime, barIndex);
    nextBarTime += BAR;
    barIndex++;
  }
}

function startBgm() {
  if (!ctx || bgmTimer) return;
  nextBarTime = ctx.currentTime + 0.15;
  barIndex = 0;
  bgmTimer = setInterval(bgmTick, 100);
  bgmTick();
}

function stopBgm() {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
}

// ------------------------------------------------------------------
// 배경음 속 은은한 북(첫 박)
// ------------------------------------------------------------------
function bgmDrum(dest, t, opts) {
  const freq = opts.freq || 70;
  const peak = opts.gain || 0.8;
  const decay = opts.decay || 0.6;

  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 2.4, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
  o.frequency.exponentialRampToValueAtTime(freq * 0.85, t + decay);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + decay + 0.05);

  const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
  o2.type = 'triangle';
  o2.frequency.setValueAtTime(freq * 1.6, t);
  o2.frequency.exponentialRampToValueAtTime(freq * 1.45, t + decay * 0.5);
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(peak * 0.25, t + 0.006);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.5);
  o2.connect(g2); g2.connect(dest);
  o2.start(t); o2.stop(t + decay);

  const slap = opts.slap != null ? opts.slap : 0.25;
  if (slap > 0) noiseBurst(dest, t, 0.05, slap, 'bandpass', 900, 0.8);
}

// ------------------------------------------------------------------
// 효과음 재료
// ------------------------------------------------------------------
/** 짧은 잡음 한 번(가죽 치는 소리 · 쿵의 둔탁함 등) */
function noiseBurst(dest, t, dur, gain, type, freq, q) {
  const n = ctx.createBufferSource(); n.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(dest);
  n.start(t, Math.random() * 2); n.stop(t + dur + 0.01);
}

/**
 * 대고(큰 북) 한 번.
 * 50~80Hz 몸통만으로는 휴대폰 스피커에서 들리지 않으므로
 * 120~250Hz '펀치' 층과 배음을 겹치고, drumBus의 찌그러뜨림으로 배음을 더 끌어올린다.
 * opts: freq(몸통 음높이) · gain · muffled(먹먹하게) · far(0~1, 멀리서 들리는 정도)
 */
function drumVoice(t, opts) {
  const f0 = opts.freq || 70;
  const peak = opts.gain || 0.8;
  const muffled = !!opts.muffled;
  const far = opts.far || 0;
  const decay = muffled ? 0.4 : 1.2;

  // 멀수록 고음이 깎이고 잔향 비중이 커진다.
  const out = ctx.createGain(); out.gain.value = 1;
  if (far > 0) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000 * Math.pow(0.08, far);
    out.connect(lp); lp.connect(vDrum);
    const send = ctx.createGain(); send.gain.value = far * 0.9;
    lp.connect(send); send.connect(vHall);
  } else {
    out.connect(vDrum);
  }

  // 몸통(쿵)
  const body = ctx.createOscillator(); const bg = ctx.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(f0 * 2, t);
  body.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
  body.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + decay);
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  body.connect(bg); bg.connect(out);
  body.start(t); body.stop(t + decay + 0.05);

  // 펀치 — 작은 스피커에서도 들리는 대역
  const pf = 165 * (f0 / 70);
  const punch = ctx.createOscillator(); const pg = ctx.createGain();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(pf * 1.6, t);
  punch.frequency.exponentialRampToValueAtTime(pf, t + 0.03);
  pg.gain.setValueAtTime(0.0001, t);
  pg.gain.exponentialRampToValueAtTime(peak * 0.6, t + 0.003);
  pg.gain.exponentialRampToValueAtTime(0.0001, t + (muffled ? 0.12 : 0.25));
  punch.connect(pg); pg.connect(out);
  punch.start(t); punch.stop(t + 0.3);

  // 가죽 배음
  const mode = ctx.createOscillator(); const mg = ctx.createGain();
  mode.type = 'triangle';
  mode.frequency.setValueAtTime(f0 * 2.3, t);
  mg.gain.setValueAtTime(0.0001, t);
  mg.gain.exponentialRampToValueAtTime(peak * 0.2, t + 0.005);
  mg.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.35);
  mode.connect(mg); mg.connect(out);
  mode.start(t); mode.stop(t + decay * 0.35 + 0.05);

  // 채가 가죽에 닿는 소리 + 둔탁한 울림
  noiseBurst(out, t, 0.035, muffled ? 0.06 : 0.3, 'bandpass', 1200, 0.9);
  noiseBurst(out, t, 0.09, peak * 0.4, 'lowpass', 350, 0.7);
}

/** 여러 사람이 함께 치는 북: n개를 살짝 어긋나게 겹친다 */
function drumHit(t, opts) {
  const n = opts.n || 1;
  for (let i = 0; i < n; i++) {
    const lead = i === 0;
    drumVoice(t + (lead ? 0 : Math.random() * 0.028), Object.assign({}, opts, {
      freq: (opts.freq || 70) * (lead ? 1 : 1 + (Math.random() - 0.5) * 0.08),
      gain: (opts.gain || 0.8) * (lead ? 1 : 0.55)
    }));
  }
}

/** 북 테두리(딱): 나무 치는 짧고 높은 소리 */
function rimHit(dest, t, gain) {
  noiseBurst(dest, t, 0.07, gain, 'bandpass', 2400, 3);
  const o = ctx.createOscillator(); const og = ctx.createGain();
  o.type = 'square'; o.frequency.value = 1150;
  og.gain.setValueAtTime(gain * 0.3, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(og); og.connect(dest);
  o.start(t); o.stop(t + 0.05);
}

/** 징: 비화성 배음 + 가까운 두 음의 맥놀이로 "지잉—" 하고 일렁이며 길게 운다 */
function jing(t, gain, f, dur) {
  const out = ctx.createGain(); out.gain.value = 1;
  // 일렁임(트레몰로)
  const lfo = ctx.createOscillator(); const lg = ctx.createGain();
  lfo.frequency.value = 3.5; lg.gain.value = 0.25;
  lfo.connect(lg); lg.connect(out.gain);
  lfo.start(t); lfo.stop(t + dur);
  out.connect(vSfx);

  const partials = [[1, 1], [1.006, 0.8], [2.0, 0.35], [2.76, 0.25], [3.94, 0.12], [5.4, 0.06]];
  partials.forEach(function (p, i) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    const pf = f * p[0];
    // 징 특유의, 친 뒤 살짝 올라가는 음
    o.frequency.setValueAtTime(pf * 0.985, t);
    o.frequency.linearRampToValueAtTime(pf * 1.01, t + 1.5);
    const d = i < 2 ? dur : dur * (0.5 - i * 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * p[1], t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + d + 0.05);
  });
  // 솜방망이 채의 둔탁한 첫소리
  noiseBurst(out, t, 0.05, gain * 0.5, 'lowpass', 600, 0.7);
}

/** 호각: 높은 음을 빠르게 떨게 하는(호루라기 알갱이) 날카로운 소리 */
function whistle(t, gain, dur) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(3100, t);
  o.frequency.exponentialRampToValueAtTime(2900, t + 0.04);
  const trill = ctx.createOscillator(); const tg = ctx.createGain();
  trill.frequency.value = 28; tg.gain.value = 180;
  trill.connect(tg); tg.connect(o.frequency);
  const am = ctx.createOscillator(); const ag = ctx.createGain();
  am.frequency.value = 28; ag.gain.value = gain * 0.35;
  am.connect(ag); ag.connect(g.gain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain * 0.6, t + 0.01);
  g.gain.setValueAtTime(gain * 0.6, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(vSfx);
  [o, trill, am].forEach(function (n) { n.start(t); n.stop(t + dur + 0.02); });
  // 입김
  const n = ctx.createBufferSource(); n.buffer = noiseBuf;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 3200; nf.Q.value = 2;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(gain * 0.2, t + 0.01);
  ng.gain.linearRampToValueAtTime(0.0001, t + dur);
  n.connect(nf); nf.connect(ng); ng.connect(vSfx);
  n.start(t, Math.random() * 2); n.stop(t + dur + 0.02);
}

/** 군중 함성 "와아—": 여러 목소리를 '아' 모음 공명(포먼트)에 통과시키고 웅성임 잡음을 덧댄다 */
function crowd(t, gain, dur) {
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(gain, t + 0.35);
  out.gain.setValueAtTime(gain, t + dur - 0.9);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(vSfx);

  const voices = ctx.createGain(); voices.gain.value = 3; // 공명 필터를 지나며 줄어드는 만큼 보충
  [[800, 4, 1], [1250, 5, 0.6], [2600, 6, 0.25]].forEach(function (fm) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fm[0]; bp.Q.value = fm[1];
    const g = ctx.createGain(); g.gain.value = fm[2];
    voices.connect(bp); bp.connect(g); g.connect(out);
  });

  for (let i = 0; i < 14; i++) {
    const f = i < 10 ? 110 + Math.random() * 80 : 200 + Math.random() * 110;
    const on = t + Math.random() * 0.25;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.92, on);
    o.frequency.linearRampToValueAtTime(f * 1.08, on + 0.45);
    o.frequency.linearRampToValueAtTime(f * 0.85, t + dur);
    const vib = ctx.createOscillator(); const vg = ctx.createGain();
    vib.frequency.value = 5 + Math.random() * 2; vg.gain.value = f * 0.02;
    vib.connect(vg); vg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, on);
    g.gain.linearRampToValueAtTime(0.06, on + 0.3);
    o.connect(g);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() * 2 - 1) * 0.8;
      g.connect(pan); pan.connect(voices);
    } else {
      g.connect(voices);
    }
    [o, vib].forEach(function (n) { n.start(on); n.stop(t + dur + 0.05); });
  }

  // 웅성임
  const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1000; nf.Q.value = 0.7;
  const ng = ctx.createGain(); ng.gain.value = 0.25;
  n.connect(nf); nf.connect(ng); ng.connect(out);
  n.start(t); n.stop(t + dur + 0.05);
}

/** 효과음이 울리는 동안 배경음을 잠깐 낮춰 북이 앞으로 나오게 한다 */
function duck(from, to, amount) {
  const p = duckGain.gain;
  p.cancelScheduledValues(from);
  p.setTargetAtTime(amount, from, 0.012);
  p.setTargetAtTime(1, to + 0.15, 0.35);
}

// ------------------------------------------------------------------
// 효과음 장단
// ------------------------------------------------------------------
// 한 번 치는 소리: { t: 시작(초), k: 'dung'|'ttak'|'jing'|'whistle'|'crowd', g: 세기, ...종류별 옵션 }
//   dung: f(음높이) · n(함께 치는 사람 수) · muffled · far
//   jing: f · dur / whistle · crowd: dur

// 휘모리처럼 몰아치다 여럿이 크게 한 번
const COMBO = [
  { t: 0, k: 'dung', g: 0.6, f: 80 }, { t: 0.1, k: 'ttak', g: 0.45 },
  { t: 0.19, k: 'dung', g: 0.65, f: 78 }, { t: 0.27, k: 'dung', g: 0.7, f: 76 },
  { t: 0.35, k: 'ttak', g: 0.5 }, { t: 0.43, k: 'dung', g: 0.75, f: 74 },
  { t: 0.5, k: 'dung', g: 0.8, f: 72 },
  { t: 0.62, k: 'dung', g: 1.1, f: 62, n: 3 }, { t: 0.62, k: 'ttak', g: 0.6 }
];

// 새벽: 멀리서 다가오는 북 → 쿵 — 쿵 — 쿵쿵쿵 + 징
const DAWN = (function () {
  const hits = [];
  for (let i = 0; i < 8; i++) hits.push({ t: i * 0.42, k: 'dung', g: 0.3 + i * 0.1, f: 58, n: 2, far: 1 - i / 8 });
  return hits.concat([
    { t: 3.7, k: 'dung', g: 1.1, f: 56, n: 3 },
    { t: 4.45, k: 'dung', g: 1.1, f: 56, n: 3 },
    { t: 5.2, k: 'dung', g: 1.0, f: 62, n: 3 },
    { t: 5.45, k: 'dung', g: 1.05, f: 62, n: 3 },
    { t: 5.7, k: 'dung', g: 1.15, f: 52, n: 4 }, { t: 5.7, k: 'ttak', g: 0.6 },
    { t: 5.7, k: 'jing', g: 0.55, f: 170, dur: 5 }
  ]);
})();

const PATTERNS = {
  tap: [{ t: 0, k: 'ttak', g: 0.35 }],
  select: [{ t: 0, k: 'ttak', g: 0.55 }],
  place: [{ t: 0, k: 'dung', g: 0.8, f: 72 }],
  combo: COMBO,
  reward: [{ t: 0, k: 'ttak', g: 0.5 }, { t: 0.1, k: 'dung', g: 0.85, f: 70 }],
  eye: [{ t: 0, k: 'dung', g: 0.7, f: 66 }, { t: 0.12, k: 'ttak', g: 0.45 }],
  // 호각 뒤 먹먹하게 가라앉는 북
  scatter: [
    { t: 0, k: 'whistle', g: 0.3, dur: 0.55 },
    { t: 0.5, k: 'dung', g: 0.8, f: 52, muffled: true },
    { t: 0.72, k: 'dung', g: 0.55, f: 46, muffled: true }
  ],
  withdraw: [{ t: 0, k: 'dung', g: 0.6, f: 60 }, { t: 0.25, k: 'dung', g: 0.6, f: 60 }, { t: 0.5, k: 'ttak', g: 0.5 }],
  blocked: [{ t: 0, k: 'dung', g: 0.7, f: 48, muffled: true }],
  // 밤이 넘어갈 때: 낮은 징 한 번
  night: [{ t: 0, k: 'jing', g: 0.35, f: 150, dur: 2.6 }, { t: 0, k: 'dung', g: 0.4, f: 54 }],
  // 태극기 완성: 여럿이 크게 쿵! 쿵! 쿵! → 함성
  flag: [
    { t: 0, k: 'dung', g: 1.1, f: 60, n: 3 }, { t: 0, k: 'ttak', g: 0.5 },
    { t: 0.34, k: 'dung', g: 1.15, f: 60, n: 3 }, { t: 0.34, k: 'ttak', g: 0.5 },
    { t: 0.68, k: 'dung', g: 1.3, f: 52, n: 4 }, { t: 0.68, k: 'ttak', g: 0.6 },
    { t: 0.8, k: 'crowd', g: 0.9, dur: 2.8 }
  ],
  dawn: DAWN
};

// 소리의 무게: 새 소리는 같거나 가벼운 앞 소리의 여운을 FADE_TO까지 줄인다.
// 0(버튼 딱)은 아무것도 줄이지 않고, 새벽(5)은 다른 소리에 줄지 않는다.
const PRIORITY = { tap: 0, select: 0, night: 1, place: 2, reward: 2, eye: 2, blocked: 2, combo: 3, scatter: 3, withdraw: 3, flag: 4, dawn: 5 };
const FADE_TO = 0.12;

// ------------------------------------------------------------------
// 공개 함수
// ------------------------------------------------------------------
export const Sound = {
  /** 설정 반영. 컨텍스트가 없으면 값만 기억해 두었다가 unlock 때 적용 */
  configure(opts) {
    if (opts.bgm != null) bgmEnabled = !!opts.bgm;
    if (opts.sfx != null) sfxEnabled = !!opts.sfx;
    if (!ctx) return;
    bgmBus.gain.setTargetAtTime(bgmEnabled ? 0.55 : 0, ctx.currentTime, 0.3);
    if (bgmEnabled) startBgm(); else stopBgm();
  },

  /** 첫 사용자 입력 때 호출: 컨텍스트 생성 · 재개, 배경음 시작 */
  unlock() {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (bgmEnabled) startBgm();
  },

  /** 앱이 가려지면 멈추고 다시 보이면 재개 */
  setHidden(hidden) {
    if (!ctx) return;
    if (hidden) { stopBgm(); ctx.suspend(); }
    else { ctx.resume().then(function () { if (bgmEnabled) startBgm(); }); }
  },

  /** 장단의 마지막 타격이 시작되는 시각(초). 결과음을 차례로 이어 칠 때 쓴다 */
  span(name) {
    const pat = PATTERNS[name];
    if (!pat) return 0;
    return pat.reduce(function (m, h) { return Math.max(m, h.t); }, 0);
  },

  /** 효과음 재생. name은 PATTERNS의 키, delay는 초 */
  play(name, delay) {
    if (!sfxEnabled || !ctx || ctx.state !== 'running') return;
    const pat = PATTERNS[name];
    if (!pat) return;
    const t0 = ctx.currentTime + 0.01 + (delay || 0);
    const prio = PRIORITY[name] || 0;
    // 겹침 정리: 새 소리가 시작되는 순간, 이미 울리고 있던 소리 중 같거나 낮은 무게의 여운을 줄인다.
    // (징 여운 위에 다음 징 · 북이 쌓이지 않도록. 버튼 '딱'은 아무것도 줄이지 않는다.
    //  한 행동에서 한꺼번에 예약한 소리끼리는 만든 시각(currentTime)이 같으므로 서로 줄이지 않는다)
    voices = voices.filter(function (v) { return v.end > ctx.currentTime; });
    if (prio > 0) {
      voices.forEach(function (v) {
        if (v.made < ctx.currentTime && v.prio <= prio) {
          v.gains.forEach(function (g) { g.gain.setTargetAtTime(FADE_TO, t0, 0.05); });
        }
      });
    }
    vDrum = ctx.createGain(); vDrum.connect(drumBus);
    vSfx = ctx.createGain(); vSfx.connect(sfxBus);
    vHall = ctx.createGain(); vHall.connect(hall);
    let end = t0;
    let heavyFrom = Infinity, heavyTo = -Infinity;
    pat.forEach(function (h) {
      end = Math.max(end, t0 + h.t + (h.dur || 1.3));
      const t = t0 + h.t;
      if (h.k === 'ttak') { rimHit(vSfx, t, h.g * 2.5); return; }
      if (h.k === 'dung') drumHit(t, { freq: h.f, gain: h.g, n: h.n, muffled: h.muffled, far: h.far });
      else if (h.k === 'jing') jing(t, h.g, h.f, h.dur);
      else if (h.k === 'whistle') whistle(t, h.g, h.dur);
      else if (h.k === 'crowd') crowd(t, h.g, h.dur);
      // 배경음 낮추기: 징 · 함성은 여운이 길어 끝까지 낮춘다
      const len = h.k === 'crowd' ? h.dur : h.k === 'jing' ? 1.5 : 0.1;
      heavyFrom = Math.min(heavyFrom, t);
      heavyTo = Math.max(heavyTo, t + len);
    });
    if (heavyTo > heavyFrom) duck(heavyFrom, heavyTo, 0.35);
    voices.push({ gains: [vDrum, vSfx, vHall], prio: prio, made: ctx.currentTime, end: end + 0.5 });
  }
};
