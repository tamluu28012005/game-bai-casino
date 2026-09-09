
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
  if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, "[]");
}
function read(file){ ensure(); try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return []; } }
function write(file,data){ ensure(); fs.writeFileSync(file, JSON.stringify(data,null,2)); }

function publicUser(u){
  return {
    id:u.id, username:u.username, nickname:u.nickname, avatar:u.avatar,
    level:u.level, xp:u.xp, coins:u.coins, wins:u.wins, losses:u.losses,
    games:u.games, winRate:u.games ? Math.round(u.wins/u.games*100) : 0,
    createdAt:u.createdAt, lastLogin:u.lastLogin
  };
}
function levelInfo(xp){
  const level = Math.max(1, Math.floor((Number(xp)||0)/100)+1);
  const inLevel = (Number(xp)||0)%100;
  return {level, xp:Number(xp)||0, next:100-inLevel};
}
function normalizeNickname(n, fallback){
  n = String(n ?? "").trim().replace(/[<>]/g,"").slice(0,24);
  return n || fallback;
}
async function register(username,password,nickname,avatar){
  username=String(username||"").trim().toLowerCase();
  if(!/^[a-z0-9_.-]{3,24}$/.test(username)) throw new Error("Tên tài khoản 3-24 ký tự, chỉ dùng a-z, 0-9, _, -, .");
  if(String(password||"").length<6) throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  const users=read(USERS_FILE);
  if(users.some(x=>x.username===username)) throw new Error("Tài khoản đã tồn tại.");
  const now=new Date().toISOString();
  const u={
    id:crypto.randomUUID(), username, passwordHash:await bcrypt.hash(password,12),
    nickname:normalizeNickname(nickname,username), avatar:String(avatar||"🤖").slice(0,8),
    level:1,xp:0,coins:1000,wins:0,losses:0,games:0,
    createdAt:now,lastLogin:now
  };
  users.push(u); write(USERS_FILE,users);
  return publicUser(u);
}
async function login(username,password){
  const users=read(USERS_FILE), u=users.find(x=>x.username===String(username||"").trim().toLowerCase());
  if(!u || !(await bcrypt.compare(String(password||""),u.passwordHash))) throw new Error("Tài khoản hoặc mật khẩu không đúng.");
  u.lastLogin=new Date().toISOString(); write(USERS_FILE,users);
  return publicUser(u);
}
async function changePassword(userId,oldPassword,newPassword){
  if(String(newPassword||"").length<6) throw new Error("Mật khẩu mới phải có ít nhất 6 ký tự.");
  const users=read(USERS_FILE), u=users.find(x=>x.id===userId);
  if(!u || !(await bcrypt.compare(String(oldPassword||""),u.passwordHash))) throw new Error("Mật khẩu hiện tại không đúng.");
  u.passwordHash=await bcrypt.hash(newPassword,12); write(USERS_FILE,users); return true;
}
function updateProfile(userId, nickname, avatar){
  const users=read(USERS_FILE), u=users.find(x=>x.id===userId);
  if(!u) throw new Error("Không tìm thấy tài khoản.");
  u.nickname=normalizeNickname(nickname,u.nickname); u.avatar=String(avatar||u.avatar).slice(0,8);
  write(USERS_FILE,users); return publicUser(u);
}
function recordGame(userId, result, bet, delta, details={}){
  const users=read(USERS_FILE), u=users.find(x=>x.id===userId); if(!u) return null;
  const outcome=String(result||"draw");
  u.games++;
  if(outcome==="win") {u.wins++; u.xp+=20;}
  else if(outcome==="loss") {u.losses++; u.xp+=5;}
  else u.xp+=8;
  u.coins=Math.max(0,(u.coins||0)+Number(delta||0));
  u.level=levelInfo(u.xp).level;
  write(USERS_FILE,users);
  const history=read(HISTORY_FILE);
  history.unshift({
    id:crypto.randomUUID(), userId, result:outcome, bet:Number(bet||0),
    delta:Number(delta||0), coins:u.coins, game:details.game||"Tài Xỉu",
    room:details.room||"Royal Table", createdAt:new Date().toISOString()
  });
  write(HISTORY_FILE,history.slice(0,10000));
  return publicUser(u);
}

function getUserByUsername(username){
  const key=String(username||'').trim().toLowerCase();
  const u=read(USERS_FILE).find(x=>x.username===key);
  return u?publicUser(u):null;
}
function recordGameByUsername(username,result,bet,delta,details={}){
  const u=getUserByUsername(username); return u?recordGame(u.id,result,bet,delta,details):null;
}

function getUser(userId){ const u=read(USERS_FILE).find(x=>x.id===userId); return u?publicUser(u):null; }
function getHistory(userId,limit=30){ return read(HISTORY_FILE).filter(x=>x.userId===userId).slice(0,Math.min(Number(limit)||30,100)); }
function leaderboard(limit=20){
  return read(USERS_FILE).map(publicUser).sort((a,b)=>b.coins-a.coins || b.xp-a.xp || b.wins-a.wins).slice(0,limit)
    .map((u,i)=>({...u,rank:i+1}));
}
module.exports={register,login,changePassword,updateProfile,recordGame,recordGameByUsername,getUser,getUserByUsername,getHistory,leaderboard,levelInfo};
