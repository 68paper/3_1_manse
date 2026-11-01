/*
 * js/link/qr.js — 연결 코드를 QR로 그리고, 카메라로 읽기(시험판)
 * ------------------------------------------------------------------
 * 그리기: vendor/qrcode-generator.mjs(MIT)
 * 읽기:   브라우저 내장 BarcodeDetector가 QR을 지원하면 그것을, 아니면(iPhone Safari 등)
 *         vendor/jsQR.min.js(Apache-2.0)를 처음 필요할 때 불러와 쓴다.
 * 두 라이브러리 모두 앱 안에 들어 있어 오프라인에서도 동작한다.
 * 카메라는 https 또는 localhost에서만 열린다.
 */
import qrcode from '../../vendor/qrcode-generator.mjs';

/** 문자열을 QR로 그린 canvas. 정보: { version, modules } */
export function drawQR(text, maxPx) {
  const qr = qrcode(0, 'L'); // 0 = 크기 자동, L = 오류 정정 최소(가장 작은 QR)
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.max(2, Math.floor((maxPx || 300) / (n + quiet * 2)));
  const size = (n + quiet * 2) * cell;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
  canvas.dataset.version = String((n - 17) / 4);
  canvas.dataset.modules = String(n);
  return canvas;
}

let jsQRPromise = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRPromise) {
    jsQRPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/jsQR.min.js', import.meta.url).href;
      s.onload = function () { window.jsQR ? resolve(window.jsQR) : reject(new Error('QR 읽기 도구를 불러오지 못했어요.')); };
      s.onerror = function () { jsQRPromise = null; reject(new Error('QR 읽기 도구를 불러오지 못했어요.')); };
      document.head.appendChild(s);
    });
  }
  return jsQRPromise;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.indexOf('qr_code') >= 0) {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async function (video) {
          const found = await det.detect(video);
          return found.length ? found[0].rawValue : null;
        };
      }
    } catch (e) { /* jsQR로 */ }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async function (video) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    // 큰 화면은 줄여서 읽는다(빠르게). 촘촘한 QR을 위해 긴 변 1024px까지는 그대로
    const scale = Math.min(1, 1024 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return found ? found.data : null;
  };
}

/**
 * 카메라로 QR을 읽는다. accept(text)가 true를 돌려주는 QR을 찾으면 그 글자를 돌려준다.
 * 돌려준 객체의 cancel()로 멈출 수 있다(그때 promise는 null로 끝남).
 */
export function scanQR(video, accept) {
  let stream = null, stopped = false, finish;
  const promise = new Promise(function (resolve, reject) {
    finish = function (value, err) {
      if (stopped) return;
      stopped = true;
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      video.srcObject = null;
      if (err) reject(err); else resolve(value);
    };
    (async function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('이 브라우저에서는 카메라를 쓸 수 없어요(https 주소에서 열어 주세요). 코드 붙여넣기를 써 주세요.');
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      if (stopped) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
      const detect = await makeDetector();
      const tick = async function () {
        if (stopped) return;
        try {
          const text = await detect(video);
          if (text && (!accept || accept(text))) { finish(text); return; }
        } catch (e) { /* 다음 프레임에 다시 */ }
        setTimeout(tick, 120);
      };
      tick();
    })().catch(function (e) {
      const msg = e && e.name === 'NotAllowedError' ? '카메라 권한이 없어요. 브라우저 설정에서 카메라를 허용하거나 코드 붙여넣기를 써 주세요.' : (e && e.message) || '카메라를 열지 못했어요.';
      finish(null, new Error(msg));
    });
  });
  return { promise: promise, cancel: function () { finish(null); } };
}
