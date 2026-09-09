const RANK_VAL = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function evalChi(cards) {
  const vals = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = true;
  for (let i = 0; i < vals.length - 1; i++) {
    if (vals[i] - vals[i + 1] !== 1) { isStraight = false; break; }
  }
  if (!isStraight && vals.join(',') === '14,5,4,3,2') isStraight = true;

  const countMap = {};
  vals.forEach(v => countMap[v] = (countMap[v] || 0) + 1);
  const counts = Object.entries(countMap).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (cards.length === 5) {
    if (isStraight && isFlush) return { score: 9, vals };
    if (counts[0][1] === 4) return { score: 8, vals: [Number(counts[0][0]), Number(counts[1][0])] };
    if (counts[0][1] === 3 && counts[1][1] === 2) return { score: 7, vals: [Number(counts[0][0]), Number(counts[1][0])] };
    if (isFlush) return { score: 6, vals };
    if (isStraight) return { score: 5, vals };
  }

  if (counts[0][1] === 3) return { score: 4, vals: [Number(counts[0][0]), ...vals.filter(v => v !== Number(counts[0][0]))] };
  if (counts[0][1] === 2 && counts[1][1] === 2) return { score: 3, vals: [Number(counts[0][0]), Number(counts[1][0]), ...vals.filter(v => v !== Number(counts[0][0]) && v !== Number(counts[1][0]))] };
  if (counts[0][1] === 2) return { score: 2, vals: [Number(counts[0][0]), ...vals.filter(v => v !== Number(counts[0][0]))] };
  return { score: 1, vals };
}

function compareChi(chiA, chiB) {
  const a = evalChi(chiA);
  const b = evalChi(chiB);
  if (a.score !== b.score) return a.score > b.score ? 1 : -1;
  for (let i = 0; i < Math.max(a.vals.length, b.vals.length); i++) {
    if ((a.vals[i] || 0) !== (b.vals[i] || 0)) {
      return (a.vals[i] || 0) > (b.vals[i] || 0) ? 1 : -1;
    }
  }
  return 0;
}

function checkBinhLung(chi1_5, chi2_5, chi3_3) {
  if (compareChi(chi1_5, chi2_5) < 0) return true;
  if (compareChi(chi2_5, chi3_3) < 0) return true;
  return false;
}

// So sánh cặp người chơi và tính số chi thắng/thua
function resolveBinhMatch(players) {
  const scores = {};
  players.forEach(p => scores[p.username] = 0);

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i];
      const p2 = players[j];

      if (p1.binhChi.isLung && p2.binhChi.isLung) continue;
      if (p1.binhChi.isLung) {
        scores[p1.username] -= 6;
        scores[p2.username] += 6;
        continue;
      }
      if (p2.binhChi.isLung) {
        scores[p1.username] += 6;
        scores[p2.username] -= 6;
        continue;
      }

      let diff = 0;
      diff += compareChi(p1.binhChi.chi1, p2.binhChi.chi1);
      diff += compareChi(p1.binhChi.chi2, p2.binhChi.chi2);
      diff += compareChi(p1.binhChi.chi3, p2.binhChi.chi3);

      scores[p1.username] += diff;
      scores[p2.username] -= diff;
    }
  }
  return scores;
}

module.exports = { compareChi, checkBinhLung, resolveBinhMatch };