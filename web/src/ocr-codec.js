// CTC collapses adjacent model steps, not repeated letters in the actual text.
// A blank between equal characters means both are real (e.g. ここ / いい).
export function decodeCTC(data, dims, dictionary) {
  const [, steps, classes] = dims;
  if (classes !== dictionary.length) throw new Error('OCRの文字辞書がモデルと一致しません。');
  let previous = -1, text = '', score = 0, count = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0, probability = -Infinity;
    for (let c = 0; c < classes; c++) {
      const value = data[t * classes + c];
      if (value > probability) { best = c; probability = value; }
    }
    if (best !== 0 && best !== previous) { text += dictionary[best]; score += probability; count++; }
    previous = best;
  }
  return { text: text.normalize('NFKC').replace(/[ \t　]+/gu, '').trim(), confidence: count ? score / count * 100 : 0 };
}
export function toModelInput({data, width, height}) {
  const plane = width * height, tensor = new Float32Array(plane * 3);
  // Official PP-OCR preprocessing: BGR, NCHW, (pixel/255 - .5)/.5.
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) tensor[c * plane + i] = data[i * 4 + 2 - c] / 127.5 - 1;
  return tensor;
}

// Select characters only when independent image scales agree.
// A high model score alone is not evidence that a similar kana was identified.
export function selectConsensus(candidates) {
  const groups = new Map();
  for (const result of candidates) {
    const group = groups.get(result.text) ?? [];
    group.push(result); groups.set(result.text, group);
  }
  const agreed = [...groups.values()].find(group => group.length >= 2 && group[0].text);
  if (agreed) return { text: agreed[0].text, confidence: agreed.reduce((sum,r) => sum+r.confidence,0)/agreed.length };
  const rows=candidates.map(result=>[...result.text]);
  // Equal-length substitutions can be voted on without moving character
  // positions. Insertions/deletions need reliable alignment: abstain for now.
  if (rows.length!==3 || !rows[0].length || rows.some(row=>row.length!==rows[0].length)) return {text:'',confidence:0};
  let text='';
  for(let i=0;i<rows[0].length;i++){
    const [a,b,c]=rows.map(row=>row[i]);
    if(a===b || a===c) text+=a;
    else if(b===c) text+=b;
    else return {text:'',confidence:0};
  }
  return {text,confidence:Math.min(...candidates.map(result=>result.confidence))};
}
