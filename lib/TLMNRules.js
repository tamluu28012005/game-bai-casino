const RANK_ORDER = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13 };
const SUIT_ORDER = { '♠': 1, '♣': 2, '♦': 3, '♥': 4 };

function cardWeight(c) {
  return RANK_ORDER[c.rank] * 10 + SUIT_ORDER[c.suit];
}

function sortTLMN(cards) {
  return [...cards].sort((a, b) => cardWeight(a) - cardWeight(b));
}

function getTLMNHandType(cards) {
  const sorted = sortTLMN(cards);
  const n = sorted.length;
  if (n === 0) return null;

  if (n === 1) return { type: 'SINGLE', highest: sorted[0] };
  if (n === 2 && sorted[0].rank === sorted[1].rank) return { type: 'PAIR', highest: sorted[1] };
  if (n === 3 && sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank) return { type: 'TRIPLE', highest: sorted[2] };
  if (n === 4 && sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank && sorted[2].rank === sorted[3].rank) {
    return { type: 'QUAD', highest: sorted[3] };
  }

  if (n >= 3) {
    const hasTwo = sorted.some(c => c.rank === '2');
    if (!hasTwo) {
      let isStraight = true;
      for (let i = 0; i < n - 1; i++) {
        if (RANK_ORDER[sorted[i + 1].rank] - RANK_ORDER[sorted[i].rank] !== 1) {
          isStraight = false; break;
        }
      }
      if (isStraight) return { type: 'STRAIGHT', length: n, highest: sorted[n - 1] };
    }
  }

  if (n === 6) {
    if (sorted[0].rank === sorted[1].rank && sorted[2].rank === sorted[3].rank && sorted[4].rank === sorted[5].rank) {
      const r1 = RANK_ORDER[sorted[0].rank], r2 = RANK_ORDER[sorted[2].rank], r3 = RANK_ORDER[sorted[4].rank];
      if (r2 - r1 === 1 && r3 - r2 === 1 && sorted[4].rank !== '2') {
        return { type: '3_PAIRS_SEQ', highest: sorted[5] };
      }
    }
  }

  if (n === 8) {
    if (sorted[0].rank === sorted[1].rank && sorted[2].rank === sorted[3].rank && sorted[4].rank === sorted[5].rank && sorted[6].rank === sorted[7].rank) {
      const r1 = RANK_ORDER[sorted[0].rank], r2 = RANK_ORDER[sorted[2].rank], r3 = RANK_ORDER[sorted[4].rank], r4 = RANK_ORDER[sorted[6].rank];
      if (r2 - r1 === 1 && r3 - r2 === 1 && r4 - r3 === 1 && sorted[6].rank !== '2') {
        return { type: '4_PAIRS_SEQ', highest: sorted[7] };
      }
    }
  }

  return null;
}

function checkTLMNBeat(newCards, prevCards, isFirstTurn = false) {
  const newHand = getTLMNHandType(newCards);
  if (!newHand) return { valid: false, error: 'Tổ hợp bài đánh ra không đúng luật Tiến Lên Miền Nam!' };

  if (isFirstTurn) {
    const hasThreeSpades = newCards.some(c => c.rank === '3' && c.suit === '♠');
    if (!hasThreeSpades) {
      return { valid: false, error: 'Lượt mở màn bắt buộc tổ hợp đánh ra phải chứa lá 3 Bích (3♠)!' };
    }
    return { valid: true };
  }

  if (!prevCards || prevCards.length === 0) return { valid: true };

  const prevHand = getTLMNHandType(prevCards);
  if (!prevHand) return { valid: true };

  if (prevHand.type === 'SINGLE' && prevHand.highest.rank === '2') {
    if (['3_PAIRS_SEQ', 'QUAD', '4_PAIRS_SEQ'].includes(newHand.type)) return { valid: true };
  }
  if (prevHand.type === 'PAIR' && prevHand.highest.rank === '2') {
    if (['QUAD', '4_PAIRS_SEQ'].includes(newHand.type)) return { valid: true };
  }
  if (prevHand.type === '3_PAIRS_SEQ') {
    if (newHand.type === '3_PAIRS_SEQ') return { valid: cardWeight(newHand.highest) > cardWeight(prevHand.highest), error: '3 đôi thông phải lớn hơn!' };
    if (['QUAD', '4_PAIRS_SEQ'].includes(newHand.type)) return { valid: true };
  }
  if (prevHand.type === 'QUAD') {
    if (newHand.type === 'QUAD') return { valid: cardWeight(newHand.highest) > cardWeight(prevHand.highest), error: 'Tứ quý phải lớn hơn!' };
    if (newHand.type === '4_PAIRS_SEQ') return { valid: true };
  }
  if (prevHand.type === '4_PAIRS_SEQ') {
    if (newHand.type === '4_PAIRS_SEQ') return { valid: cardWeight(newHand.highest) > cardWeight(prevHand.highest), error: '4 đôi thông phải lớn hơn!' };
  }

  if (newHand.type === prevHand.type) {
    if (newHand.type === 'STRAIGHT' && newHand.length !== prevHand.length) {
      return { valid: false, error: 'Sảnh phải có cùng độ dài mới bắt được!' };
    }
    const win = cardWeight(newHand.highest) > cardWeight(prevHand.highest);
    return { valid: win, error: win ? null : 'Bài bạn chọn bé hơn bài trên bàn!' };
  }

  return { valid: false, error: 'Bài đánh ra không cùng thể loại với bài trên bàn!' };
}

module.exports = { sortTLMN, getTLMNHandType, checkTLMNBeat, cardWeight };