// Conservative phrase correction, not a global large-kana -> small-kana map.
// These are explicit kana confusions in common expressions. Ambiguous words
// such as きよう (器用), もつと (持つと), and いつしようか are left untouched.
const rules = [
  [/い[っつ]し[ょよ](?=に)/gu, 'いっしょ'],
  [/ち[ょよ][っつ]と/gu, 'ちょっと'],
  [/ゆ[っつ]くり/gu, 'ゆっくり'],
  [/び[っつ]くり/gu, 'びっくり'],
  [/や[っつ]ぱり/gu, 'やっぱり'],
  [/ま[っつ]すぐ/gu, 'まっすぐ'],
  [/そ[っつ]くり/gu, 'そっくり'],
  [/し[っつ]かり/gu, 'しっかり'],
  [/す[っつ]かり/gu, 'すっかり'],
  [/ば[っつ]ちり/gu, 'ばっちり'],
  [/ぐ[っつ]すり/gu, 'ぐっすり'],
  [/こ[っつ]そり/gu, 'こっそり'],
  [/が[っつ]かり/gu, 'がっかり'],
  [/ぜ[っつ]たい/gu, 'ぜったい'],
  [/さ[っつ]そく/gu, 'さっそく'],
  [/い[っつ]ぱい/gu, 'いっぱい']
];
export function correctSmallKana(text) {
  let corrected = text;
  for (const [pattern, replacement] of rules) corrected = corrected.replace(pattern, replacement);
  return corrected;
}
