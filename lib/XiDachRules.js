function calcXiDach(cards) {
  let sum = 0;
  let aceCount = 0;

  for (let c of cards) {
    if (['J', 'Q', 'K'].includes(c.rank)) sum += 10;
    else if (c.rank === 'A') { aceCount++; sum += 11; }
    else sum += parseInt(c.rank, 10);
  }

  while (sum > 21 && aceCount > 0) {
    sum -= 10;
    aceCount--;
  }

  const isXiBang = cards.length === 2 && cards[0].rank === 'A' && cards[1].rank === 'A';
  const isXiDach = cards.length === 2 && ((cards[0].rank === 'A' && ['10','J','Q','K'].includes(cards[1].rank)) ||
                                         (cards[1].rank === 'A' && ['10','J','Q','K'].includes(cards[0].rank)));
  const isNguLinh = cards.length === 5 && sum <= 21;

  return { sum, isXiBang, isXiDach, isNguLinh, isBust: sum > 21 };
}

module.exports = { calcXiDach };