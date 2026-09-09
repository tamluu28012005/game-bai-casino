const RANK_ORDER = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13 };

function sortSam(cards) {
  return [...cards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
}

function getSamHand(cards) {
  const sorted = sortSam(cards);
  const n = sorted.length;
  if (n === 0) return null;

  if (n === 1) return { type: 'SINGLE', rankVal: RANK_ORDER[sorted[0].rank] };
  if (n === 2 && sorted[0].rank === sorted[1].rank) return { type: 'PAIR', rankVal: RANK_ORDER[sorted[0].rank] };
  if (n === 3 && sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank) return { type: 'TRIPLE', rankVal: RANK_ORDER[sorted[0].rank] };
  if (n === 4 && sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank && sorted[2].rank === sorted[3].rank) return { type: 'QUAD', rankVal: RANK_ORDER[sorted[0].rank] };

  if (n >= 3) {
    const codes = sorted.map(c => c.rank);
    if (n === 3 && codes.includes('A') && codes.includes('2') && codes.includes('3')) {
      return { type: 'STRAIGHT', length: 3, rankVal: 0 };
    }
    if (!codes.includes('2')) {
      let isStraight = true;
      for (let i = 0; i < n - 1; i++) {
        if (RANK_ORDER[codes[i + 1]] - RANK_ORDER[codes[i]] !== 1) { isStraight = false; break; }
      }
      if (isStraight) return { type: 'STRAIGHT', length: n, rankVal: RANK_ORDER[codes[n - 1]] };
    }
  }

  return null;
}

function checkSamBeat(newCards, prevCards) {
  const newHand = getSamHand(newCards);
  if (!newHand) return { valid: false, error: 'Tổ hợp bài không đúng luật Sâm Lốc!' };
  if (!prevCards || prevCards.length === 0) return { valid: true };

  const prevHand = getSamHand(prevCards);
  if (!prevHand) return { valid: true };

  if (prevHand.type === 'SINGLE' && prevHand.rankVal === 13 && newHand.type === 'QUAD') return { valid: true };
  if (prevHand.type === 'QUAD' && newHand.type === 'QUAD') return { valid: newHand.rankVal > prevHand.rankVal, error: 'Tứ quý phải lớn hơn!' };

  if (newHand.type === prevHand.type) {
    if (newHand.type === 'STRAIGHT' && newHand.length !== prevHand.length) return { valid: false, error: 'Sảnh phải cùng số lá!' };
    return { valid: newHand.rankVal > prevHand.rankVal, error: 'Bài đánh ra phải có giá trị số lớn hơn!' };
  }

  return { valid: false, error: 'Không cùng loại bài với bài trên bàn!' };
}

module.exports = { sortSam, checkSamBeat };