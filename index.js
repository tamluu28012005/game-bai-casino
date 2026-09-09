const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const Deck = require('./lib/Deck');
const { sortTLMN, checkTLMNBeat } = require('./lib/TLMNRules');
const { compareChi, checkBinhLung, resolveBinhMatch } = require('./lib/BinhRules');
const { sortSam, checkSamBeat } = require('./lib/SamRules');
const { calcXiDach } = require('./lib/XiDachRules');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const USERS = {}; 
const ROOMS = {}; 

function getSafeRoom(room) {
  if (!room) return null;
  const { turnTimer, samTimer, deck, ...safeRoom } = room;
  return safeRoom;
}

function emitRoomState(roomId) {
  const room = ROOMS[roomId];
  if (!room) return;
  io.to(roomId).emit('room_state_change', getSafeRoom(room));
}

function emitLobbyUpdate() {
  const safeRooms = Object.values(ROOMS).map(getSafeRoom);
  io.emit('lobby_update', { rooms: safeRooms });
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin!' });
  if (USERS[username]) return res.status(400).json({ error: 'Tài khoản đã tồn tại!' });

  const passwordHash = await bcrypt.hash(password, 8);
  USERS[username] = { username, passwordHash, balance: 10000 };
  res.json({ success: true, message: 'Đăng ký thành công! Tặng 10.000 xu.' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = USERS[username];
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(400).json({ error: 'Sai tài khoản hoặc mật khẩu!' });
  }
  res.json({ success: true, user: { username: user.username, balance: user.balance } });
});

function leaveCurrentRoom(socket) {
  const roomId = socket.currentRoomId;
  if (!roomId || !ROOMS[roomId]) return;

  const room = ROOMS[roomId];
  room.players = room.players.filter(p => p.socketId !== socket.id);
  socket.leave(roomId);
  delete socket.currentRoomId;

  const realPlayers = room.players.filter(p => !p.isBot);
  if (realPlayers.length === 0) {
    clearTimeout(room.turnTimer);
    clearTimeout(room.samTimer);
    delete ROOMS[roomId];
  } else {
    if (room.host === socket.username && room.players[0]) room.host = room.players[0].username;
    if (room.dealer === socket.username && room.players[0]) room.dealer = room.players[0].username;
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    emitRoomState(roomId);
  }
  emitLobbyUpdate();
}

function findSmallestCardPlayer(players) {
  const RANK_PRIORITY = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const SUIT_PRIORITY = ['♠', '♣', '♦', '♥'];

  for (const rank of RANK_PRIORITY) {
    for (const suit of SUIT_PRIORITY) {
      for (let i = 0; i < players.length; i++) {
        const hasCard = players[i].cards.some(c => c.rank === rank && c.suit === suit);
        if (hasCard) {
          return { playerIndex: i, smallestCard: { rank, suit, code: `${rank}${suit}` } };
        }
      }
    }
  }
  return { playerIndex: 0, smallestCard: null };
}

function startTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnStartTime = Date.now();
  io.to(room.id).emit('turn_timer_start', { username: room.currentTurn, duration: 30 });

  room.turnTimer = setTimeout(() => {
    if (room.status !== 'PLAYING') return;

    if (room.type === 'xidach') {
      const player = room.players.find(p => p.username === room.currentTurn);
      if (player && !player.xidachDone) {
        player.xidachDone = true;
        io.to(room.id).emit('player_passed_notice', { username: player.username });
        advanceXiDachTurn(room);
      }
    } else if (['tienlen', 'sam'].includes(room.type)) {
      if (room.tableCards && room.tableCards.length > 0) {
        io.to(room.id).emit('player_passed_notice', { username: room.currentTurn });
        advanceTurn(room);
      } else {
        const player = room.players.find(p => p.username === room.currentTurn);
        if (player && player.cards.length > 0) {
          const autoCard = [player.cards[0]];
          player.cards.shift();
          room.tableCards = autoCard;
          room.lastPlayerPlay = player.username;
          room.isFirstGameTurn = false;
          room.firstRequiredCard = null;

          if (player.cards.length === 0) return declareWinner(room, player);

          do {
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
          } while (room.passedPlayers.includes(room.players[room.turnIndex].username));

          room.currentTurn = room.players[room.turnIndex].username;
          emitRoomState(room.id);
          startTurnTimer(room);
          runBotTurn(room);
        }
      }
    }
  }, 30500);
}

function advanceTurn(room) {
  room.passedPlayers.push(room.currentTurn);
  const activePlayers = room.players.filter(p => !room.passedPlayers.includes(p.username));

  if (activePlayers.length <= 1) {
    const roundLeader = activePlayers[0] || room.players.find(p => p.username === room.lastPlayerPlay);
    room.tableCards = [];
    room.passedPlayers = [];
    room.lastPlayerPlay = null;
    room.turnIndex = room.players.findIndex(p => p.username === roundLeader.username);
    room.currentTurn = roundLeader.username;
    io.to(room.id).emit('banner_notify', `Vòng mới! Lượt đánh thuộc về: [${roundLeader.username}]`);
  } else {
    do {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    } while (room.passedPlayers.includes(room.players[room.turnIndex].username));

    room.currentTurn = room.players[room.turnIndex].username;
  }

  emitRoomState(room.id);
  startTurnTimer(room);
  runBotTurn(room);
}

function compareXiDachSingle(dealerCards, playerCards) {
  const dScore = calcXiDach(dealerCards);
  const pScore = calcXiDach(playerCards);
  let win = false;
  let msg = '';

  if (pScore.isXiBang && !dScore.isXiBang) { win = true; msg = 'Thắng (Xì Bàng)'; }
  else if (dScore.isXiBang && !pScore.isXiBang) { win = false; msg = 'Thua (Cái có Xì Bàng)'; }
  else if (pScore.isXiBang && dScore.isXiBang) { win = false; msg = 'Hòa (Cùng Xì Bàng)'; }
  else if (pScore.isXiDach && !dScore.isXiDach) { win = true; msg = 'Thắng (Xì Dách)'; }
  else if (dScore.isXiDach && !pScore.isXiDach) { win = false; msg = 'Thua (Cái có Xì Dách)'; }
  else if (pScore.isXiDach && dScore.isXiDach) { win = false; msg = 'Hòa (Cùng Xì Dách)'; }
  else if (pScore.isNguLinh && !dScore.isNguLinh) { win = true; msg = 'Thắng (Ngũ Linh)'; }
  else if (dScore.isNguLinh && !pScore.isNguLinh) { win = false; msg = 'Thua (Cái Ngũ Linh)'; }
  else if (pScore.isNguLinh && dScore.isNguLinh) {
    if (pScore.sum < dScore.sum) { win = true; msg = `Thắng (Ngũ Linh ${pScore.sum} < ${dScore.sum})`; }
    else if (pScore.sum > dScore.sum) { win = false; msg = `Thua (Ngũ Linh ${pScore.sum} > ${dScore.sum})`; }
    else { win = false; msg = 'Hòa Ngũ Linh'; }
  }
  else if (pScore.isBust && dScore.isBust) { win = false; msg = 'Hòa Quắc'; }
  else if (pScore.isBust) { win = false; msg = 'Thua (Quắc)'; }
  else if (dScore.isBust) { win = true; msg = 'Thắng (Cái Quắc)'; }
  else if (pScore.sum > dScore.sum) { win = true; msg = `Thắng (${pScore.sum} > ${dScore.sum})`; }
  else if (pScore.sum < dScore.sum) { win = false; msg = `Thua (${pScore.sum} < ${dScore.sum})`; }
  else { win = false; msg = `Hòa (${pScore.sum} điểm)`; }

  return { win, msg, pScore: pScore.sum, dScore: dScore.sum };
}

function finalizeXiDachRound(room) {
  clearTimeout(room.turnTimer);
  const dealer = room.players.find(p => p.username === room.dealer) || room.players[0];
  const dScore = calcXiDach(dealer.cards);

  room.players.forEach(p => {
    if (p.username === room.dealer) return;
    if (!room.xidachResults[p.username]) {
      const cmp = compareXiDachSingle(dealer.cards, p.cards);
      room.xidachResults[p.username] = {
        username: p.username,
        win: cmp.win,
        msg: cmp.msg,
        cards: p.cards,
        score: cmp.pScore
      };
    }
  });

  room.status = 'WAITING';
  io.to(room.id).emit('xidach_showdown', {
    dealer: { username: dealer.username, cards: dealer.cards, score: dScore.sum },
    results: Object.values(room.xidachResults)
  });
  emitRoomState(room.id);
  io.to(room.id).emit('game_ended', getSafeRoom(room));
}

function advanceXiDachTurn(room) {
  const unfinishedCon = room.players.filter(p => p.username !== room.dealer && !p.xidachDone);

  if (unfinishedCon.length > 0) {
    const nextPlayer = unfinishedCon[0];
    room.turnIndex = room.players.findIndex(p => p.username === nextPlayer.username);
    room.currentTurn = nextPlayer.username;
    startTurnTimer(room);
  } else {
    const dealerPlayer = room.players.find(p => p.username === room.dealer);
    if (!dealerPlayer.xidachDone) {
      room.turnIndex = room.players.findIndex(p => p.username === room.dealer);
      room.currentTurn = room.dealer;
      io.to(room.id).emit('banner_notify', `Lượt Nhà Cái [${room.dealer}] rút & xét bài!`);
      startTurnTimer(room);
    } else {
      finalizeXiDachRound(room);
      return;
    }
  }

  emitRoomState(room.id);
  runBotTurn(room);
}

function runBotTurn(room) {
  if (!room || room.status !== 'PLAYING') return;

  if (room.type === 'xidach') {
    const bot = room.players[room.turnIndex];
    if (!bot || !bot.isBot || bot.xidachDone) return;

    setTimeout(() => {
      if (room.status !== 'PLAYING') return;
      const score = calcXiDach(bot.cards);
      const isDealer = (bot.username === room.dealer);

      if (isDealer) {
        if (score.sum < 16 && !score.isBust && bot.cards.length < 5) {
          bot.cards.push(room.deck.deal(1)[0]);
          emitRoomState(room.id);
          runBotTurn(room);
        } else {
          bot.xidachDone = true;
          finalizeXiDachRound(room);
        }
      } else {
        if (score.sum < 16 && !score.isBust && bot.cards.length < 5) {
          bot.cards.push(room.deck.deal(1)[0]);
          emitRoomState(room.id);
          runBotTurn(room);
        } else {
          bot.xidachDone = true;
          advanceXiDachTurn(room);
        }
      }
    }, 1200);
    return;
  }

  if (['tienlen', 'sam'].includes(room.type)) {
    const bot = room.players[room.turnIndex];
    if (!bot || !bot.isBot) return;

    setTimeout(() => {
      if (room.status !== 'PLAYING') return;
      const checkFn = room.type === 'tienlen' ? checkTLMNBeat : checkSamBeat;

      if (!room.tableCards || room.tableCards.length === 0) {
        let cardToPlay = bot.cards[0];
        if (room.isFirstGameTurn && room.firstRequiredCard) {
          const matched = bot.cards.find(c => c.rank === room.firstRequiredCard.rank && c.suit === room.firstRequiredCard.suit);
          if (matched) cardToPlay = matched;
        }

        bot.cards = bot.cards.filter(c => c.code !== cardToPlay.code);
        room.tableCards = [cardToPlay];
        room.lastPlayerPlay = bot.username;
        room.passedPlayers = [];
        room.isFirstGameTurn = false;
        room.firstRequiredCard = null;

        if (bot.cards.length === 0) return declareWinner(room, bot);

        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        room.currentTurn = room.players[room.turnIndex].username;
        emitRoomState(room.id);
        startTurnTimer(room);
        runBotTurn(room);
        return;
      }

      let move = null;
      if (room.tableCards.length === 1) {
        for (let c of bot.cards) {
          if (checkFn([c], room.tableCards).valid) { move = [c]; break; }
        }
      } else if (room.tableCards.length === 2) {
        for (let i = 0; i < bot.cards.length - 1; i++) {
          if (bot.cards[i].rank === bot.cards[i + 1].rank) {
            const pair = [bot.cards[i], bot.cards[i + 1]];
            if (checkFn(pair, room.tableCards).valid) { move = pair; break; }
          }
        }
      }

      if (move) {
        if (room.type === 'sam' && room.baoSamPlayer && room.baoSamPlayer !== bot.username) {
          io.to(room.id).emit('banner_notify', `❌ BẮT ĐƯỢC SÂM! Bot [${bot.username}] chặn thành công! [${room.baoSamPlayer}] ĐỀN LÀNG!`);
          room.lastWinner = bot.username;
          room.status = 'WAITING';
          room.baoSamPlayer = null;
          clearTimeout(room.turnTimer);
          emitRoomState(room.id);
          io.to(room.id).emit('game_ended', getSafeRoom(room));
          return;
        }

        const codes = move.map(m => m.code);
        bot.cards = bot.cards.filter(c => !codes.includes(c.code));
        room.tableCards = move;
        room.lastPlayerPlay = bot.username;
        room.isFirstGameTurn = false;
        room.firstRequiredCard = null;

        if (bot.cards.length === 0) return declareWinner(room, bot);

        do {
          room.turnIndex = (room.turnIndex + 1) % room.players.length;
        } while (room.passedPlayers.includes(room.players[room.turnIndex].username));

        room.currentTurn = room.players[room.turnIndex].username;
        emitRoomState(room.id);
        startTurnTimer(room);
        runBotTurn(room);
      } else {
        io.to(room.id).emit('player_passed_notice', { username: bot.username });
        advanceTurn(room);
      }
    }, 1200);
  }
}

function declareWinner(room, player) {
  clearTimeout(room.turnTimer);
  room.status = 'WAITING';
  room.lastWinner = player.username;

  if (room.type === 'sam' && room.baoSamPlayer === player.username) {
    io.to(room.id).emit('banner_notify', `🔥 [${player.username}] BÁO SÂM THÀNH CÔNG VÀ THẮNG TUYỆT ĐỐI!`);
  } else {
    io.to(room.id).emit('banner_notify', `🎉 Người chơi [${player.username}] đã chiến thắng ván đấu!`);
  }
  room.baoSamPlayer = null;
  emitRoomState(room.id);
  io.to(room.id).emit('game_ended', getSafeRoom(room));
}

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('auth_session', ({ username }) => {
    if (USERS[username]) {
      currentUser = USERS[username];
      currentUser.socketId = socket.id;
      socket.username = username;
      socket.emit('lobby_update', { rooms: Object.values(ROOMS).map(getSafeRoom), balance: currentUser.balance });
    }
  });

  socket.on('create_room', ({ roomName, gameType }) => {
    if (!currentUser) return;
    const roomId = 'R_' + Math.random().toString(36).substring(2, 7).toUpperCase();

    let max = 4;
    if (gameType === 'xidach') max = 10;
    if (gameType === 'sam') max = 5;

    ROOMS[roomId] = {
      id: roomId,
      name: roomName || `Bàn ${roomId}`,
      type: gameType,
      maxPlayers: max,
      host: currentUser.username,
      dealer: currentUser.username,
      players: [{ username: currentUser.username, balance: currentUser.balance, socketId: socket.id, cards: [], isBot: false, binhDone: false, binhChi: null, xidachDone: false, xidachChecked: false }],
      status: 'WAITING',
      currentTurn: null,
      turnIndex: 0,
      passedPlayers: [],
      tableCards: [],
      lastPlayerPlay: null,
      isFirstGameTurn: true,
      firstRequiredCard: null,
      lastWinner: null,
      baoSamPlayer: null,
      samTimer: null,
      turnTimer: null,
      xidachResults: {},
      deck: null
    };

    socket.join(roomId);
    socket.currentRoomId = roomId;
    socket.emit('room_joined', getSafeRoom(ROOMS[roomId]));
    emitLobbyUpdate();
  });

  socket.on('set_dealer', ({ username }) => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.status === 'PLAYING') return;
    if (room.host !== currentUser.username) return socket.emit('banner_notify', 'Chỉ chủ phòng mới được chuyển Cái!');
    
    const target = room.players.find(p => p.username === username);
    if (!target) return;

    room.dealer = username;
    io.to(room.id).emit('banner_notify', `👑 Nhà Cái đã được đổi thành: [${username}]`);
    emitRoomState(room.id);
  });

  socket.on('join_room', ({ roomId }) => {
    const room = ROOMS[roomId];
    if (!room) return socket.emit('banner_notify', 'Bàn không tồn tại!');
    if (room.players.length >= room.maxPlayers) return socket.emit('banner_notify', 'Bàn đã đủ người!');
    if (room.status === 'PLAYING') return socket.emit('banner_notify', 'Bàn đang diễn ra!');

    room.players.push({ username: currentUser.username, balance: currentUser.balance, socketId: socket.id, cards: [], isBot: false, binhDone: false, binhChi: null, xidachDone: false, xidachChecked: false });
    socket.join(roomId);
    socket.currentRoomId = roomId;

    socket.emit('room_joined', getSafeRoom(room));
    emitRoomState(roomId);
    emitLobbyUpdate();
  });

  socket.on('add_bot', () => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.status === 'PLAYING') return;
    if (room.host !== currentUser.username) return socket.emit('banner_notify', 'Chỉ chủ phòng mới được thêm Bot!');
    if (room.players.length >= room.maxPlayers) return socket.emit('banner_notify', 'Bàn đã đầy người!');

    const botCount = room.players.filter(p => p.isBot).length + 1;
    room.players.push({
      username: `Bot_${botCount}`,
      balance: 10000,
      socketId: `BOT_${Date.now()}_${botCount}`,
      cards: [],
      isBot: true,
      binhDone: false,
      binhChi: null,
      xidachDone: false,
      xidachChecked: false
    });

    emitRoomState(room.id);
    emitLobbyUpdate();
  });

  socket.on('remove_bot', () => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.status === 'PLAYING') return;
    if (room.host !== currentUser.username) return;

    const botIndex = room.players.map(p => p.isBot).lastIndexOf(true);
    if (botIndex !== -1) {
      room.players.splice(botIndex, 1);
      emitRoomState(room.id);
      emitLobbyUpdate();
    }
  });

  socket.on('start_game', () => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.host !== currentUser.username) return;
    if (room.players.length < 2) return socket.emit('banner_notify', 'Cần tối thiểu 2 người để chơi!');

    room.status = 'PLAYING';
    room.tableCards = [];
    room.passedPlayers = [];
    room.baoSamPlayer = null;
    room.xidachResults = {};

    room.deck = new Deck();
    room.deck.shuffle();

    let count = 13;
    if (room.type === 'sam') count = 10;
    if (room.type === 'xidach') count = 2;

    room.players.forEach(p => {
      const dealt = room.deck.deal(count);
      p.cards = room.type === 'sam' ? sortSam(dealt) : sortTLMN(dealt);
      p.binhDone = false;
      p.binhChi = null;
      p.xidachDone = false;
      p.xidachChecked = false;

      if (p.isBot && room.type === 'binh') {
        p.binhChi = {
          chi1: p.cards.slice(0, 5),
          chi2: p.cards.slice(5, 10),
          chi3: p.cards.slice(10, 13),
          isLung: false
        };
        p.binhDone = true;
      }
    });

    if (room.type === 'xidach') {
      const firstCon = room.players.find(p => p.username !== room.dealer) || room.players[0];
      room.turnIndex = room.players.findIndex(p => p.username === firstCon.username);
      room.currentTurn = firstCon.username;
    } else if (room.lastWinner) {
      const winIdx = room.players.findIndex(p => p.username === room.lastWinner);
      room.turnIndex = winIdx !== -1 ? winIdx : 0;
      room.isFirstGameTurn = false;
      room.firstRequiredCard = null;
      room.currentTurn = room.players[room.turnIndex].username;
    } else {
      const result = findSmallestCardPlayer(room.players);
      room.turnIndex = result.playerIndex;
      room.isFirstGameTurn = true;
      room.firstRequiredCard = result.smallestCard;
      room.currentTurn = room.players[room.turnIndex].username;
    }

    if (room.type === 'sam') {
      room.status = 'BAO_SAM';
      io.to(room.id).emit('sam_start_bao', { time: 5 });
      io.to(room.id).emit('game_started', getSafeRoom(room));

      clearTimeout(room.samTimer);
      room.samTimer = setTimeout(() => {
        if (room.status === 'BAO_SAM') {
          room.status = 'PLAYING';
          emitRoomState(room.id);
          startTurnTimer(room);
          runBotTurn(room);
        }
      }, 5500);
      return;
    }

    io.to(room.id).emit('game_started', getSafeRoom(room));

    if (room.type !== 'binh') {
      startTurnTimer(room);
      runBotTurn(room);
    }
  });

  socket.on('action_bao_sam', ({ isBao }) => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.type !== 'sam' || room.status !== 'BAO_SAM') return;

    if (isBao && !room.baoSamPlayer) {
      clearTimeout(room.samTimer);
      room.baoSamPlayer = currentUser.username;
      room.status = 'PLAYING';
      room.turnIndex = room.players.findIndex(p => p.username === currentUser.username);
      room.currentTurn = currentUser.username;
      room.isFirstGameTurn = false;
      room.firstRequiredCard = null;

      io.to(room.id).emit('banner_notify', `🔥 [${currentUser.username}] ĐÃ BÁO SÂM! Được quyền đánh trước!`);
      emitRoomState(room.id);
      startTurnTimer(room);
      runBotTurn(room);
    }
  });

  socket.on('play_cards', ({ cards }) => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.status !== 'PLAYING') return;
    if (room.currentTurn !== currentUser.username) return socket.emit('banner_notify', 'Chưa tới lượt của bạn!');

    if (room.isFirstGameTurn && room.firstRequiredCard && !room.baoSamPlayer) {
      const hasReq = cards.some(c => c.rank === room.firstRequiredCard.rank && c.suit === room.firstRequiredCard.suit);
      if (!hasReq) {
        return socket.emit('banner_notify', `Lượt mở màn bắt buộc phải đánh lá (${room.firstRequiredCard.code})!`);
      }
    }

    let check = { valid: true };
    if (room.type === 'tienlen') {
      check = checkTLMNBeat(cards, room.tableCards, false);
    }
    if (room.type === 'sam') {
      check = checkSamBeat(cards, room.tableCards);
      const p = room.players.find(x => x.username === currentUser.username);
      if (p.cards.length === cards.length && cards.some(c => c.rank === '2')) {
        return socket.emit('banner_notify', 'Luật Sâm Lốc: Cấm về bằng quân Heo!');
      }
    }

    if (!check.valid) return socket.emit('banner_notify', check.error);

    if (room.type === 'sam' && room.baoSamPlayer && room.baoSamPlayer !== currentUser.username) {
      io.to(room.id).emit('banner_notify', `❌ BẮT ĐƯỢC SÂM! [${currentUser.username}] đã chặn! [${room.baoSamPlayer}] ĐỀN LÀNG!`);
      room.lastWinner = currentUser.username;
      room.status = 'WAITING';
      room.baoSamPlayer = null;
      clearTimeout(room.turnTimer);
      emitRoomState(room.id);
      io.to(room.id).emit('game_ended', getSafeRoom(room));
      return;
    }

    const player = room.players.find(p => p.username === currentUser.username);
    const cardCodes = cards.map(c => c.code);
    player.cards = player.cards.filter(c => !cardCodes.includes(c.code));

    room.tableCards = cards;
    room.lastPlayerPlay = currentUser.username;
    room.isFirstGameTurn = false;
    room.firstRequiredCard = null;

    if (player.cards.length === 0) return declareWinner(room, player);

    do {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    } while (room.passedPlayers.includes(room.players[room.turnIndex].username));

    room.currentTurn = room.players[room.turnIndex].username;
    emitRoomState(room.id);
    startTurnTimer(room);
    runBotTurn(room);
  });

  socket.on('pass_turn', () => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.status !== 'PLAYING') return;
    if (room.currentTurn !== currentUser.username) return socket.emit('banner_notify', 'Chưa tới lượt của bạn!');
    if (!room.tableCards || room.tableCards.length === 0) return socket.emit('banner_notify', 'Bạn đang cầm vòng mới, không được bỏ lượt!');

    io.to(room.id).emit('player_passed_notice', { username: currentUser.username });
    advanceTurn(room);
  });

  socket.on('xidach_hit', () => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.type !== 'xidach' || room.currentTurn !== currentUser.username) return;

    const player = room.players.find(p => p.username === currentUser.username);
    if (player.cards.length >= 5) return socket.emit('banner_notify', 'Đã rút tối đa 5 lá!');

    player.cards.push(room.deck.deal(1)[0]);
    const score = calcXiDach(player.cards);
    if (score.isBust) {
      socket.emit('banner_notify', `Đã quắc! (${score.sum} điểm)`);
      player.xidachDone = true;
      advanceXiDachTurn(room);
    } else {
      startTurnTimer(room);
      emitRoomState(room.id);
    }
  });

  socket.on('xidach_stand', () => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.type !== 'xidach' || room.currentTurn !== currentUser.username) return;

    const player = room.players.find(p => p.username === currentUser.username);
    const score = calcXiDach(player.cards);
    const isDealer = (player.username === room.dealer);
    const minPoint = isDealer ? 15 : 16;

    if (score.sum < minPoint && !score.isXiBang && !score.isXiDach) {
      return socket.emit('banner_notify', `Chưa đủ ${minPoint} tuổi, không được dằn bài!`);
    }

    player.xidachDone = true;
    advanceXiDachTurn(room);
  });

  // NHÀ CÁI XÉT BÀI TỪNG NHÀ CON KHI ĐẠT >= 16 ĐIỂM
  socket.on('xidach_check_player', ({ targetUsername }) => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.type !== 'xidach' || room.status !== 'PLAYING') return;
    if (currentUser.username !== room.dealer) return socket.emit('banner_notify', 'Chỉ Nhà Cái mới có quyền xét bài!');

    const dealer = room.players.find(p => p.username === room.dealer);
    const dScore = calcXiDach(dealer.cards);

    if (dScore.sum < 16 && !dScore.isXiBang && !dScore.isXiDach && !dScore.isBust) {
      return socket.emit('banner_notify', 'Nhà Cái chưa đủ 16 tuổi, không được quyền xét bài!');
    }

    const target = room.players.find(p => p.username === targetUsername);
    if (!target || target.xidachChecked) return socket.emit('banner_notify', 'Người chơi này đã được xét rồi!');

    const cmp = compareXiDachSingle(dealer.cards, target.cards);
    target.xidachChecked = true;
    room.xidachResults[target.username] = {
      username: target.username,
      win: cmp.win,
      msg: cmp.msg,
      cards: target.cards,
      score: cmp.pScore
    };

    io.to(room.id).emit('banner_notify', `🔍 Nhà Cái xét [${target.username}]: ${cmp.msg}`);
    emitRoomState(room.id);

    const allConChecked = room.players.filter(p => p.username !== room.dealer).every(p => p.xidachChecked);
    if (allConChecked) {
      dealer.xidachDone = true;
      finalizeXiDachRound(room);
    }
  });

  socket.on('submit_binh', ({ chi1, chi2, chi3 }) => {
    const room = ROOMS[socket.currentRoomId];
    if (!room || room.type !== 'binh') return;

    const player = room.players.find(p => p.username === currentUser.username);
    if (!player) return;

    const isLung = checkBinhLung(chi1, chi2, chi3);
    player.binhChi = { chi1, chi2, chi3, isLung };
    player.binhDone = true;

    if (isLung) socket.emit('banner_notify', 'Cảnh báo: Bạn đã bị BINH LỦNG!');

    if (room.players.every(p => p.binhDone)) {
      room.status = 'WAITING';
      const chiScores = resolveBinhMatch(room.players);
      io.to(room.id).emit('binh_showdown', { room: getSafeRoom(room), scores: chiScores });
      emitRoomState(room.id);
      io.to(room.id).emit('game_ended', getSafeRoom(room));
    } else {
      io.to(room.id).emit('player_binh_done', { username: player.username });
      emitRoomState(room.id);
    }
  });

  socket.on('leave_room', () => {
    leaveCurrentRoom(socket);
    socket.emit('left_room_success');
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Game Casino đang chạy trên port: ${PORT}`));
