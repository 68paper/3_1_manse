/*
 * js/link/rtc.js — 기기끼리 직접 연결(WebRTC 데이터 채널), 시험판
 * ------------------------------------------------------------------
 * 인터넷 없이 같은 Wi-Fi(또는 휴대폰 핫스팟)에 있는 두 기기를 잇는다.
 * 보통은 중계 서버가 "연결 정보(SDP)"를 전해 주지만, 여기서는 그 정보를
 * 코드 문자열로 만들어 QR 코드(또는 복사 · 붙여넣기)로 직접 주고받는다.
 *
 *   방장: createOffer() → 코드 A를 보여 줌
 *   참가자: acceptOffer(A) → 코드 B를 보여 줌
 *   방장: acceptAnswer(B) → 연결
 *
 * STUN · TURN 서버를 쓰지 않으므로(iceServers: []) 같은 네트워크 안에서만 연결된다.
 * 연결 정보는 한 번에 다 모아서(ICE 수집 완료 뒤) 코드 하나에 담는다.
 */

import { ConnLog } from './connlog.js';

const CODE_PREFIX_DEFLATE = 'M1'; // deflate-raw로 압축 + base64url
const CODE_PREFIX_PLAIN = 'M0';   // 압축을 못 하는 브라우저: base64url만
const ICE_TIMEOUT_MS = 4000;

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function pipeBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// 연결과 상관없는 SDP 줄은 빼서 코드를 줄인다(데이터 채널만 쓰므로 영향 없음)
function trimSdp(sdp) {
  return sdp.split('\r\n').filter(function (line) {
    return !/^a=(extmap-allow-mixed|msid-semantic)/.test(line);
  }).join('\r\n');
}

/** { t: 'o' | 'a', s: sdp } → 코드 문자열 */
export async function encodeSignal(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return CODE_PREFIX_DEFLATE + toBase64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw'))); }
    catch (e) { /* 아래로 */ }
  }
  return CODE_PREFIX_PLAIN + toBase64Url(bytes);
}

/** 코드 문자열 → { t, s }. 형식이 틀리면 예외 */
export async function decodeSignal(code) {
  const text = String(code || '').trim();
  const head = text.slice(0, 2);
  const body = fromBase64Url(text.slice(2));
  let bytes;
  if (head === CODE_PREFIX_DEFLATE) {
    if (typeof DecompressionStream !== 'function') throw new Error('이 브라우저는 압축된 코드를 풀 수 없어요.');
    bytes = await pipeBytes(body, new DecompressionStream('deflate-raw'));
  } else if (head === CODE_PREFIX_PLAIN) {
    bytes = body;
  } else {
    throw new Error('연결 코드가 아니에요.');
  }
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (!obj || (obj.t !== 'o' && obj.t !== 'a') || typeof obj.s !== 'string') throw new Error('연결 코드가 아니에요.');
  return obj;
}

/**
 * PeerLink — 상대 한 명과의 연결.
 * 이벤트: on('open'), on('message', obj), on('close', reason), on('state', connectionState)
 * 상태가 바뀔 때마다 연결 기록(connlog.js)에 남긴다. label은 기록에 쓸 상대 이름.
 */
export class PeerLink {
  constructor(label) {
    this.label = label || '상대';
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.channel = null;
    this.handlers = {};
    this.closed = false;
    this.closeReason = null;
    const self = this;
    this.pc.addEventListener('connectionstatechange', function () {
      const st = self.pc.connectionState;
      self.log('연결 상태: ' + st);
      self._emit('state', st);
      if (st === 'failed' || st === 'closed') self._close(st === 'failed' ? '연결에 실패했어요(네트워크 경로가 끊김).' : '연결이 닫혔어요.');
    });
    // ICE 상태: disconnected는 잠깐 끊긴 것(다시 붙을 수 있음), failed는 완전히 끊긴 것
    this.pc.addEventListener('iceconnectionstatechange', function () { self.log('ICE 상태: ' + self.pc.iceConnectionState); });
  }

  log(what) { ConnLog.add(this.label, what); }

  /** 기록에 쓸 이름을 바꾼다(닉네임을 알게 된 뒤) */
  setLabel(label) { this.label = label || this.label; }

  // 연결된 뒤 어떤 길로 이어졌는지(같은 Wi-Fi 안 직접 연결인지 등) 기록
  async _logRoute() {
    try {
      const stats = await this.pc.getStats();
      let pair = null;
      stats.forEach(function (r) { if (r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
      this.log('연결 경로: 내 쪽 ' + (local ? local.candidateType + '/' + (local.protocol || '') + (local.networkType ? '/' + local.networkType : '') : '?') +
        ' · 상대 쪽 ' + (remote ? remote.candidateType + '/' + (remote.protocol || '') : '?') +
        (pair.currentRoundTripTime != null ? ' · 왕복 ' + Math.round(pair.currentRoundTripTime * 1000) + 'ms' : ''));
    } catch (e) { /* 통계를 못 읽어도 연결에는 상관없음 */ }
  }

  on(name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    // 받는 쪽이 붙기 전에 온 말은 모아 두었다가 이때 차례대로 건넨다(연결 직후 첫 말이 사라지지 않게)
    if (name === 'message' && this.pending && this.pending.length) {
      const queued = this.pending; this.pending = null;
      queued.forEach(function (obj) { fn(obj); });
    }
    return this;
  }
  _emit(name, arg) { (this.handlers[name] || []).forEach(function (fn) { fn(arg); }); }
  _close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    this.log('끊김: ' + reason);
    this._emit('close', reason);
  }

  _bindChannel(ch) {
    const self = this;
    this.channel = ch;
    ch.addEventListener('open', function () { self.log('데이터 채널 열림'); self._logRoute(); self._emit('open'); });
    ch.addEventListener('close', function () { self._close(self.closing ? '내가 연결을 닫았어요.' : '상대와 연결이 끊겼어요(상대가 화면을 닫았거나 네트워크가 끊김).'); });
    ch.addEventListener('error', function (e) { self.log('데이터 채널 오류: ' + ((e && e.error && e.error.message) || '알 수 없음')); });
    ch.addEventListener('message', function (e) {
      let obj;
      try { obj = JSON.parse(e.data); } catch (err) { return; }
      if (!(self.handlers.message && self.handlers.message.length)) { (self.pending = self.pending || []).push(obj); return; }
      self._emit('message', obj);
    });
  }

  _waitIce() {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (resolve) {
      const done = function () {
        if (pc.iceGatheringState !== 'complete') return;
        pc.removeEventListener('icegatheringstatechange', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(function () { pc.removeEventListener('icegatheringstatechange', done); resolve(); }, ICE_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', done);
    });
  }

  async _localCode(type) {
    await this._waitIce();
    const sdp = this.pc.localDescription.sdp;
    if (!/a=candidate/.test(sdp)) throw new Error('네트워크 주소를 찾지 못했어요. Wi-Fi나 핫스팟에 연결되어 있는지 확인해 주세요.');
    return encodeSignal({ t: type, s: trimSdp(sdp) });
  }

  /** 방장: 연결 코드(A)를 만든다 */
  async createOffer() {
    this._bindChannel(this.pc.createDataChannel('manse', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    return this._localCode('o');
  }

  /** 참가자: 방장의 코드(A)를 받고 답장 코드(B)를 만든다 */
  async acceptOffer(code) {
    const sig = await decodeSignal(code);
    if (sig.t !== 'o') throw new Error('방장 화면의 첫 번째 QR을 찍어 주세요.');
    const self = this;
    this.pc.addEventListener('datachannel', function (e) { self._bindChannel(e.channel); });
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.s });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return this._localCode('a');
  }

  /** 방장: 참가자의 답장 코드(B)를 받아 연결을 마친다 */
  async acceptAnswer(code) {
    const sig = await decodeSignal(code);
    if (sig.t !== 'a') throw new Error('참가자 화면의 답장 QR을 찍어 주세요.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.s });
  }

  send(obj) {
    if (!this.channel || this.channel.readyState !== 'open') return false;
    try { this.channel.send(JSON.stringify(obj)); } catch (e) { this.log('보내기 실패: ' + e.message); return false; }
    return true;
  }

  close(why) {
    if (this.closed) return;
    this.closing = true;
    try { if (this.channel) this.channel.close(); } catch (e) { /* 무시 */ }
    try { this.pc.close(); } catch (e) { /* 무시 */ }
    this._close(why || '내가 연결을 닫았어요.');
  }
}
