import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCTC,toModelInput,selectConsensus} from '../web/src/ocr-codec.js';
const dict=['','こ','い','っ','ょ','1','2'];
function decode(indices) {
 const data=new Float32Array(indices.length*dict.length);
 indices.forEach((n,i)=>data[i*dict.length+n]=1);
 return decodeCTC(data,[1,indices.length,dict.length],dict).text;
}
test('CTCの同一文字ステップはまとめ、本来の「ここ」「いい」は残す',()=>{
 assert.equal(decode([1,1,0,1,1]),'ここ');
 assert.equal(decode([2,2,0,2,2]),'いい');
});
test('小書きかなと数字を書き換えない',()=>{
 assert.equal(decode([2,0,3,0,4,0,5,0,6]),'いっょ12');
});
test('モデルと辞書が不一致なら誤った文字列を返さない',()=>{
 assert.throws(()=>decodeCTC(new Float32Array(2),[1,1,2],dict),/辞書/);
});
test('公式のBGR・CHW・-1〜1正規化と一致する',()=>{
 const actual=toModelInput({width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,0,0,255,255])});
 assert.deepEqual(Array.from(actual),[-1,1,-1,-1,1,-1]);
});
test('OCRの高い確信度1件より複数サイズの一致を採用する',()=>{
 assert.deepEqual(selectConsensus([{text:'甲',confidence:99},{text:'乙',confidence:90},{text:'乙',confidence:94}]),{text:'乙',confidence:92});
});
test('2サイズが一致した読みをそのまま使い、単語を書き換えない',()=>{
 for(const text of ['きよう','きょう','ここにいいもの','いつしようか？','いっぽん']){
  assert.equal(selectConsensus([{text,confidence:90},{text,confidence:95}]).text,text);
 }
});
test('全サイズで異なる読み、単独候補、空の認識は採用しない',()=>{
 for(const candidates of [[],[{text:'甲',confidence:99}],[{text:'甲',confidence:99},{text:'乙',confidence:99},{text:'丙',confidence:99}],[{text:'',confidence:0},{text:'',confidence:0}]]){
  assert.deepEqual(selectConsensus(candidates),{text:'',confidence:0});
 }
});
test('異なる位置の誤りを文字単位の一致で解消し、文字数の違いは保留する',()=>{
 assert.equal(selectConsensus([{text:'甲乙誤',confidence:95},{text:'甲誤丙',confidence:94},{text:'誤乙丙',confidence:93}]).text,'甲乙丙');
 assert.equal(selectConsensus([{text:'甲乙',confidence:95},{text:'甲丙乙',confidence:94},{text:'甲',confidence:93}]).text,'');
});
import {textAngle,removeEdgeInk,inkGray,isJapaneseText} from '../web/src/ocr.js';
test('短い感嘆や「……」「ー」を含むセリフも日本語として扱う',()=>{
 for(const text of ['わーい!','えっ!?','ピカー!','ええーっ!?','......ありがとう。','そうなんだ......','えっと......\nどうしよう?','うん!','きのみを10こあつめよう。']) assert.ok(isJapaneseText(text),text);
});
test('記号だけ・英数字ばかり・日本語1文字の認識結果は読まない',()=>{
 for(const text of ['','......','!?','l1I','OK!','A12','う!']) assert.ok(!isJapaneseText(text),text);
});
test('濃い色の文字は黒文字と同じく残し、薄い色の縁取り・背景・次へ矢印は消す',()=>{
 for(const [r,g,b] of [[208,64,42],[47,111,208],[47,154,74],[224,122,16],[138,63,192]]) assert.ok(inkGray(r,g,b)<140,`${r},${g},${b}`);
 for(const [r,g,b] of [[187,158,232],[138,171,120],[251,167,2],[163,196,89]]) assert.equal(inkGray(r,g,b),255,`${r},${g},${b}`);
 assert.equal(inkGray(48,54,56),53);assert.equal(inkGray(245,245,245),245);
});
test('横向きの標本化に偏らず4度の文字行の傾きを検出する',()=>{
 const width=600,height=140,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let x=40;x<550;x++) for(const y0 of [30,80]) for(let dy=0;dy<13;dy++){
  const y=Math.round(y0+x*Math.tan(4*Math.PI/180)+dy);const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=30;
 }
 assert.ok(Math.abs(textAngle({data,width,height})-4)<=.5);
});
test('端につながった背景を除去し、内部の文字は保持する',()=>{
 const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(const [x0,y0,w,h] of [[0,0,25,20],[50,40,8,12]])for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){
  const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=20;
 }
 removeEdgeInk({data,width,height});assert.equal(data[0],255);assert.equal(data[(45*width+53)*4],20);
});
