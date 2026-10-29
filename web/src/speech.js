export class Speaker {
  constructor(onState) { this.onState = onState; this.rate = 1; this.voiceURI = ''; this.token = 0; }
  voices() { return window.speechSynthesis?.getVoices().filter(v => /^ja\b/i.test(v.lang)) ?? []; }
  speak(text) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error('このブラウザでは音声を使えません。SafariまたはChromeで開いてください。');
    this.stop();
    const token = this.token;
    const utterance = new SpeechSynthesisUtterance(text.replace(/\n/gu, ' '));
    const voices = this.voices();
    utterance.lang = 'ja-JP'; utterance.rate = this.rate;
    utterance.voice = voices.find(v => v.voiceURI === this.voiceURI) ?? voices.find(v => v.localService) ?? voices[0] ?? null;
    // Keep a strong reference until end/error (some WebKit versions need it).
    this.current = utterance;
    utterance.onstart = () => { if (token === this.token) this.onState('speaking'); };
    utterance.onend = () => { if (token === this.token) { clearTimeout(this.timer); this.current = null; this.onState('idle'); } };
    utterance.onerror = event => {
      if (token !== this.token || ['interrupted', 'canceled'].includes(event.error)) return;
      clearTimeout(this.timer); this.current = null; this.onState('error');
    };
    this.timer = setTimeout(() => {
      if (token === this.token) { this.stop(); this.onState('error'); }
    }, Math.max(18000, text.length * 350 / this.rate));
    window.speechSynthesis.speak(utterance);
  }
  unlock() { this.speak('読み上げをはじめます'); }
  stop() { this.token++; clearTimeout(this.timer); this.current = null; window.speechSynthesis?.cancel(); this.onState('idle'); }
}
