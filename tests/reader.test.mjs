import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingGate, normalizeText, findDialoguePanel, mainTextBands } from '../web/src/reader-core.js';

test('文字送りの途中は読まず、完成したセリフを一度だけ読む', () => {
  const gate = new ReadingGate();
  assert.equal(gate.accept('こんに', 0), null);
  assert.equal(gate.accept('こんにちは', 700), null);
  assert.equal(gate.accept('こんにちは！', 1400), null);
  assert.equal(gate.accept('こんにちは！', 2100), null);
  assert.equal(gate.accept('こんにちは！', 2800), 'こんにちは！');
  assert.equal(gate.accept('こんにちは！', 4000), null);
});
test('空白や改行の変化だけで読み直さない', () => {
  const gate = new ReadingGate();
  for (const t of [0, 700, 1400]) gate.accept('いっしょに　あそぼう', t);
  for (const t of [2100, 2800, 3500]) assert.equal(gate.accept('いっしょに\nあそぼう', t), null);
});
test('一瞬の見失いでは読み直さず、会話が閉じてからは同文も読める', () => {
  const gate = new ReadingGate();
  for (const t of [0, 700, 1400]) gate.accept('ありがとう', t);
  gate.accept('', 2000);
  for (const t of [2700, 3400, 4100]) assert.equal(gate.accept('ありがとう', t), null);
  for (const t of [5000, 6000, 7600]) gate.accept('', t);
  gate.accept('ありがとう', 8000); gate.accept('ありがとう', 8700);
  assert.equal(gate.accept('ありがとう', 9400), 'ありがとう');
});
test('数値と小書きかなの違いは消さない', () => {
  assert.notEqual(normalizeText('10こ'), normalizeText('11こ'));
  assert.notEqual(normalizeText('きょう'), normalizeText('きよう'));
  assert.equal(normalizeText('Ａ　１２'), 'A12');
});
test('OCRが揺れているときは読み上げない', () => {
  const gate = new ReadingGate();
  for (let i = 0; i < 20; i++) assert.equal(gate.accept(i % 2 ? 'あそぽう' : 'あそぼう', i * 900), null);
});
test('認識が一瞬保留になっても、同じセリフが出ている間に読み上げる', () => {
  const gate = new ReadingGate();
  assert.equal(gate.accept('いっしょにあそぼう', 0), null);
  assert.equal(gate.accept('', 850), null);
  assert.equal(gate.accept('いっしょにあそぼう', 1700), null);
  assert.equal(gate.accept('', 2550), null);
  assert.equal(gate.accept('いっしょにあそぼう', 3400), 'いっしょにあそぼう');
});
test('会話欄が閉じたままなら確認回数をやり直す', () => {
  const gate = new ReadingGate();
  gate.accept('こんにちは', 0); gate.accept('こんにちは', 700);
  gate.accept('', 1400); gate.accept('', 4000);
  assert.equal(gate.accept('こんにちは', 4500), null);
  assert.equal(gate.accept('こんにちは', 5200), null);
  assert.equal(gate.accept('こんにちは', 5900), 'こんにちは');
});
test('長い中断後は再び複数回確認する', () => {
  const gate = new ReadingGate();
  gate.accept('こんにちは', 0); gate.accept('こんにちは', 700);
  assert.equal(gate.accept('こんにちは', 20000), null);
  assert.equal(gate.accept('こんにちは', 20700), null);
  assert.equal(gate.accept('こんにちは', 21400), 'こんにちは');
});
function image(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (x, y, w, h, rgb) => { for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data.set([...rgb, 255], (row * width + col) * 4); };
  fill(0, 0, width, height, color);
  return { data, width, height, fill };
}
test('画面位置が変わっても吹き出しを検出する', () => {
  const im = image(640, 360, [50, 100, 50]);
  im.fill(115, 246, 410, 94, [190, 160, 230]); im.fill(125, 256, 390, 74, [245, 245, 245]);
  im.fill(153, 278, 170, 10, [50, 50, 50]); im.fill(153, 306, 200, 10, [50, 50, 50]);
  const panel = findDialoguePanel(im);
  assert.ok(panel); assert.ok(Math.abs(panel.x - 125 / 640) < .01);
});
test('白い空・無地・紫枠のないメニューは読まない', () => {
  for (const color of [[255, 255, 255], [100, 130, 100], [0, 0, 0]]) assert.equal(findDialoguePanel(image(640, 360, color)), null);
  const im = image(640, 360, [50, 100, 50]);
  im.fill(125, 256, 390, 74, [245, 245, 245]); im.fill(153, 278, 170, 10, [50, 50, 50]);
  assert.equal(findDialoguePanel(im), null);
});
test('2文字ほどの短いセリフでも吹き出しを検出し、空の吹き出しは検出しない', () => {
  const im = image(640, 360, [50, 100, 50]);
  im.fill(115, 246, 410, 94, [190, 160, 230]); im.fill(125, 256, 390, 74, [245, 245, 245]);
  assert.equal(findDialoguePanel(im), null);
  im.fill(153, 283, 3, 10, [50, 50, 50]); im.fill(150, 287, 10, 2, [50, 50, 50]);
  im.fill(166, 283, 3, 10, [50, 50, 50]); im.fill(163, 287, 10, 2, [50, 50, 50]);
  assert.ok(findDialoguePanel(im));
});
test('色付きの文字だけの短いセリフでも吹き出しを検出する', () => {
  const im = image(640, 360, [50, 100, 50]);
  im.fill(115, 246, 410, 94, [190, 160, 230]); im.fill(125, 256, 390, 74, [245, 245, 245]);
  im.fill(153, 280, 60, 10, [208, 64, 42]);
  assert.ok(findDialoguePanel(im));
});
test('吹き出しに白い服が接していても上の突起を除外する', () => {
  const im = image(640, 360, [50, 100, 50]);
  im.fill(115, 246, 410, 94, [190, 160, 230]); im.fill(125, 256, 390, 74, [245, 245, 245]);
  im.fill(400, 220, 35, 50, [245, 245, 245]); im.fill(153, 278, 170, 10, [50, 50, 50]);
  const panel = findDialoguePanel(im); assert.ok(panel); assert.ok(panel.y >= 255 / 360);
});
test('ふりがなの小さい行は除外する', () => {
  const im = image(300, 120, [250, 250, 250]);
  im.fill(20, 8, 25, 6, [40, 40, 40]); im.fill(20, 20, 160, 24, [40, 40, 40]);
  im.fill(100, 60, 15, 7, [40, 40, 40]); im.fill(20, 74, 200, 24, [40, 40, 40]);
  assert.deepEqual(mainTextBands(im), [{ y: 20, height: 24 }, { y: 74, height: 24 }]);
});
