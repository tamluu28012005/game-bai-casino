class Deck {
  constructor() {
    this.suits = ['♠', '♣', '♦', '♥'];
    this.ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    this.cards = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const rank of this.ranks) {
      for (const suit of this.suits) {
        this.cards.push({ rank, suit, code: `${rank}${suit}` });
      }
    }
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count) {
    return this.cards.splice(0, count);
  }
}

module.exports = Deck;