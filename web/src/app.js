import { ReadingGate } from './reader-core.js?v=5';
import { LocalReader } from './ocr.js?v=5';
import { Speaker } from './speech.js?v=5';

const $ = id => document.getElementById(id);
const video = $('video'), still = $('still'), overlay = $('overlay');
const frame = document.createElement('canvas');
const gate = new ReadingGate();
let active = false, runID = 0, stream = null, timer = null, wakeLock = null;
let mode = 'camera', busy = false, preparing = false, lastText = '', emptySince = null;
const speaker = new Speaker(state => {
  $('speech-state').textContent = state === 'speaking' ? 'よんでいます' : '待機中';
  if (state === 'error') showError('音声が止まりました。端末の音量を確認して「もういちど」を押してください。');
});
const reader = new LocalReader(message => {
  if (!active || !preparing) return;
  const names = { 'loading tesseract core': '文字認識の準備', 'loading language traineddata': '日本語データの準備', 'initializing api': '読み取りの準備' };
  if (names[message.status]) status(`${names[message.status]}… ${Math.round((message.progress ?? 0) * 100)}%`);
});

function status(text) { $('status').textContent = text; }
function showError(text = '') { $('error').textContent = text; $('error').hidden = !text; }
function setActive(value) {
  active = value; document.body.classList.toggle('is-running', value);
  $('start-label').textContent = value ? 'とめる' : 'はじめる';
  $('start-symbol').textContent = value ? '■' : '▶';
  $('start').classList.toggle('active', value); $('live-dot').classList.toggle('on', value);
}
function cameraError(error) {
  if (error.name === 'NotAllowedError') return 'カメラが許可されていません。Safariのページ設定からカメラを許可して、もう一度「はじめる」を押してください。';
  if (error.name === 'NotFoundError') return '使えるカメラが見つかりません。「おためし画面」や「写真でためす」でも確認できます。';
  if (error.name === 'NotReadableError') return 'ほかのアプリがカメラを使っている可能性があります。カメラを使うアプリを閉じて、もう一度お試しください。';
  return error.message || '準備できませんでした。通信状態を確認して、もう一度お試しください。';
}
async function start() {
  if (active) { stop(); return; }
  showError();
  try { speaker.unlock(); } catch (error) { showError(error.message); return; }
  const id = ++runID; gate.reset(); setActive(true); preparing = true;
  status('準備しています…');
  try {
    if (mode === 'camera') {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('iPhoneでカメラを使うにはHTTPSのURLが必要です。公開前のローカル版では「おためし画面」を使ってください。');
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 10, max: 15 } }, audio: false
      });
      if (id !== runID) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired; video.srcObject = stream; video.hidden = false; still.hidden = true;
      $('placeholder').hidden = true;
      await video.play();
      acquired.getVideoTracks()[0].addEventListener('ended', () => {
        if (id === runID) { stop(); showError('カメラの接続が切れました。「はじめる」で再接続できます。'); }
      });
    }
    try { await reader.ready(); }
    catch { throw new Error('文字認識データを準備できませんでした。通信状態を確認して、もう一度お試しください。'); }
    if (id !== runID) return;
    preparing = false;
    $('camera-label').textContent = mode === 'camera' ? 'カメラで見守り中' : mode === 'demo' ? 'おためし画面' : '写真でおためし';
    status('会話が出るのを待っています。');
    if ('wakeLock' in navigator) {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (id !== runID) { await lock.release(); return; }
        wakeLock = lock;
      } catch { $('tip').textContent = '画面が暗くなる場合は、自動ロックを調整してご利用ください。'; }
    }
    tick(id);
  } catch (error) {
    if (id !== runID) return;
    stop(); showError(cameraError(error));
  }
}
function stop(message = 'おやすみ中です。「はじめる」で再開できます。') {
  ++runID; setActive(false); preparing = false; clearTimeout(timer); gate.reset();
  speaker.stop(); stream?.getTracks().forEach(track => track.stop()); stream = null;
  video.srcObject = null; video.hidden = true;
  wakeLock?.release().catch(() => {}); wakeLock = null;
  $('placeholder').hidden = mode !== 'camera';
  $('camera-label').textContent = mode === 'camera' ? 'カメラの準備' : mode === 'demo' ? 'おためし画面' : '写真でおためし';
  paintPanel(null); status(message);
}
async function tick(id) {
  if (!active || id !== runID) return;
  if (busy) { timer = setTimeout(() => tick(id), 200); return; }
  busy = true;
  const started = performance.now();
  try {
    const source = mode === 'camera' ? video : still;
    const w = mode === 'camera' ? video.videoWidth : still.width;
    const h = mode === 'camera' ? video.videoHeight : still.height;
    if (!w || !h) { status('カメラの映像を待っています…'); return; }
    frame.width = w; frame.height = h; frame.getContext('2d').drawImage(source, 0, 0, w, h);
    const result = await reader.recognize(frame);
    if (id !== runID) return;
    paintPanel(result.panel, w, h);
    if (result.text) {
      emptySince = null; lastText = result.text;
      $('recognized').textContent = result.text;
      $('transcript').classList.add('has-text'); $('repeat').disabled = false;
      const text = gate.accept(result.text, performance.now());
      if (text) { speaker.speak(text); status('新しいセリフを読み上げました。'); }
      else status('セリフを確認しています。同じ文はくり返し読みません。');
    } else {
      gate.accept('', performance.now()); emptySince ??= performance.now();
      status(result.panel ? '文字を確認中です。カメラを固定して少し近づけてください。' : '会話が出るのを待っています。画面全体を映してください。');
      if (performance.now() - emptySince > 2500) {
        $('recognized').textContent = '次のおはなしを\n待っています。'; $('transcript').classList.remove('has-text');
      }
    }
  } catch (error) {
    if (id === runID) { stop(); showError('文字認識を続けられませんでした。通信状態を確認し「はじめる」で再試行してください。'); }
  } finally {
    busy = false;
    if (active && id === runID) timer = setTimeout(() => tick(id), Math.max(180, 850 - (performance.now() - started)));
  }
}
function paintPanel(panel, imageW = 16, imageH = 10) {
  const rect = $('viewfinder').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(rect.width * dpr); overlay.height = Math.round(rect.height * dpr);
  const ctx = overlay.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
  $('frame-badge').hidden = !panel;
  if (!panel) return;
  const scale = Math.min(rect.width / imageW, rect.height / imageH);
  const offsetX = (rect.width - imageW * scale) / 2, offsetY = (rect.height - imageH * scale) / 2;
  ctx.strokeStyle = '#a8e6b6'; ctx.lineWidth = 2.5;
  ctx.strokeRect(offsetX + panel.x * imageW * scale, offsetY + panel.y * imageH * scale,
    panel.width * imageW * scale, panel.height * imageH * scale);
}
function demo() {
  stop(); mode = 'demo'; still.width = 1280; still.height = 720;
  const ctx = still.getContext('2d');
  ctx.fillStyle = '#9bc6c3'; ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = '#b6cd8f'; ctx.beginPath(); ctx.ellipse(640, 680, 980, 360, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#6b9667';
  for (const [x, y, r] of [[130, 270, 80], [1050, 290, 110], [860, 350, 60]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#f3dc9a'; ctx.beginPath(); ctx.ellipse(510, 440, 60, 70, -.15, 0, 7); ctx.fill();
  ctx.fillStyle = '#f5f0df'; ctx.beginPath(); ctx.ellipse(780, 445, 60, 75, .1, 0, 7); ctx.fill();
  ctx.fillStyle = '#35553f'; for (const x of [495, 525, 765, 795]) { ctx.beginPath(); ctx.arc(x, 425, 5, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#bb9ee8'; ctx.beginPath(); ctx.roundRect(220, 565, 840, 152, 64); ctx.fill();
  ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.roundRect(235, 578, 810, 137, 55); ctx.fill();
  ctx.fillStyle = '#5ab7c7'; ctx.beginPath(); ctx.roundRect(335, 540, 220, 35, 17); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('おともだち', 375, 567);
  ctx.fillStyle = '#303638'; ctx.font = '32px sans-serif';
  ctx.fillText('こんにちは！', 285, 632); ctx.fillText('いっしょに あそぼう！', 285, 681);
  setStillMode(); status('これは動作確認用の画面です。「はじめる」で読み上げます。');
}
function setStillMode() {
  still.hidden = false; video.hidden = true; $('placeholder').hidden = true;
  $('camera-mode').hidden = false; $('camera-label').textContent = mode === 'demo' ? 'おためし画面' : '写真でおためし';
  $('recognized').textContent = '「はじめる」で\nセリフを読んでみよう。'; $('transcript').classList.remove('has-text');
  lastText = ''; $('repeat').disabled = true;
}
$('start').addEventListener('click', start);
$('demo').addEventListener('click', demo);
$('repeat').addEventListener('click', () => { if (lastText) { showError(); gate.markRead(lastText); speaker.speak(lastText); } });
$('camera-mode').addEventListener('click', () => {
  stop(); mode = 'camera'; still.hidden = true; $('placeholder').hidden = false; $('camera-mode').hidden = true;
  status('「はじめる」でカメラを使います。'); $('camera-label').textContent = 'カメラの準備';
  lastText = ''; $('repeat').disabled = true; $('recognized').textContent = 'ここに、読み取った\nセリフが出てきます。'; $('transcript').classList.remove('has-text');
});
$('photo').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  stop(); showError();
  if (file.size > 30 * 1024 * 1024) { showError('写真が大きすぎます。30MB以下の画像を選んでください。'); return; }
  const url = URL.createObjectURL(file), image = new Image(), id = runID;
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (id !== runID) return;
    mode = 'photo'; const scale = Math.min(1, 2560 / image.naturalWidth);
    still.width = Math.round(image.naturalWidth * scale); still.height = Math.round(image.naturalHeight * scale);
    still.getContext('2d').drawImage(image, 0, 0, still.width, still.height);
    setStillMode(); status('写真を開きました。「はじめる」で読み上げます。');
  } catch { showError('写真を開けませんでした。JPEG・PNGなどの画像でお試しください。'); }
  finally { URL.revokeObjectURL(url); event.target.value = ''; }
});
document.querySelector('.photo-label').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('photo').click(); } });
$('settings-open').addEventListener('click', () => $('settings').showModal());
$('rate').addEventListener('change', event => { speaker.rate = Number(event.target.value); saveSettings(); });
$('voice').addEventListener('change', event => { speaker.voiceURI = event.target.value; saveSettings(); });
$('voice-test').addEventListener('click', () => { showError(); try { speaker.speak('こんにちは。いっしょに、あそぼう！'); } catch (error) { showError(error.message); } });
function refreshVoices() {
  $('voice').replaceChildren(new Option('日本語の標準音声', ''), ...speaker.voices().map(v => new Option(v.name, v.voiceURI)));
  $('voice').value = speaker.voiceURI;
}
function saveSettings() { try { localStorage.setItem('yomiage-settings', JSON.stringify({ rate: speaker.rate, voice: speaker.voiceURI })); } catch {} }
try {
  const saved = JSON.parse(localStorage.getItem('yomiage-settings') || '{}');
  if ([0.85, 1, 1.15].includes(saved.rate)) { speaker.rate = saved.rate; $('rate').value = String(saved.rate); }
  if (typeof saved.voice === 'string') speaker.voiceURI = saved.voice;
} catch {}
refreshVoices(); window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active) stop('画面を離れたため停止しました。「はじめる」で再開できます。');
});
window.addEventListener('pagehide', () => stop());
if ('serviceWorker' in navigator && window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) navigator.serviceWorker.register('./sw.js').catch(() => {});
