/* ============================================================
   СЪРВЪРЪТ НА ИГРАТА  „ПОЗНАЙ 5“
   ------------------------------------------------------------
   Прави две неща наведнъж, на един и същ адрес:

   1. Отваря играта на http://localhost:8080
   2. Свързва се към чата на TikTok LIVE и подава всеки коментар
      на играта (браузърът няма как да го направи сам)

   Тук НЕ се решава кое е познато и кое не — сървърът само пренася
   думите. Разпознаването на близки и сгрешени думи е в index.html.

   Не се пуска директно — пусни START.bat в горната папка.
   ============================================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);

/* Твоят профил в TikTok. Свързва се към него сам, без да го въвеждаш.
   Смениш ли акаунта, смени го тук — това е единственото място. */
const DEFAULT_USER = "oneisthelonliestnumber69";
const ROOT = path.join(__dirname, '..');          // папката с index.html

/* ---------- 1. раздаване на файловете на играта ---------- */
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.woff2':'font/woff2', '.mp3':'audio/mpeg'
};

const httpServer = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if(rel === '/' || rel === '') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel));
  if(!file.startsWith(ROOT)){                      // защита срещу ../../
    res.writeHead(403); res.end('403'); return;
  }
  fs.readFile(file, (err, data) => {
    if(err){
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('Няма такъв файл: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ---------- 2. връзка с TikTok ---------- */
let conn = null;
let currentUser = "";
let viewers = 0;
let wanted = "";          // към кого искаме да сме свързани

/* Помним името и настройките, за да може прозорчето в TikTok Studio,
   където не може да се цъка, да тръгне само с последно ползваните. */
const SETUP_FILE = path.join(__dirname, '.stream-setup.json');
function readSetup(){
  try{ return JSON.parse(fs.readFileSync(SETUP_FILE,'utf8')); }
  catch{
    try{ return { user: fs.readFileSync(path.join(__dirname,'.last-user'),'utf8').trim() }; }
    catch{ return {}; }
  }
}
function writeSetup(patch){
  try{ fs.writeFileSync(SETUP_FILE, JSON.stringify({ ...readSetup(), ...patch })); }catch{}
}
const readUser = () => readSetup().user || DEFAULT_USER;
const saveUser = u => writeSetup({ user: u });
let retryTimer = null;    // чакане стриймът да тръгне
const RETRY_SEC = 15;

const wss = new WebSocketServer({ server: httpServer });   // същият порт като играта

/* Когато е пуснат публичен линк, през него влизат непознати хора.
   Те получават само играта — нито виждат TikTok чата, нито могат да
   пипат връзката към стрийма. Това важи само за домакина на компютъра. */
const viaTunnel = req => !!(req.headers["cf-connecting-ip"] ||
                            req.headers["cf-ray"] ||
                            req.headers["x-forwarded-for"]);

function send(ws, obj){ if(ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(obj){
  const s = JSON.stringify(obj);
  for(const c of wss.clients) if(c.readyState === c.OPEN && c.isHost) c.send(s);
}
function status(extra = {}){
  const setup = readSetup();
  return {
    type:"status",
    connected: !!(conn && currentUser),
    user: currentUser || wanted || readUser(), viewers,
    setup: { time: setup.time, rounds: setup.rounds, hints: setup.hints },
    // има ли запомнено име, значи е за стрийм — тогава играта тръгва сама
    autostart: !!setup.user,
    ...extra
  };
}

// работи и със стария, и с новия формат на библиотеката
function readChat(data){
  const u = data.user || {};
  return {
    type: "chat",
    userId: String(u.id || u.displayId || data.userId || data.uniqueId || ""),
    nick:  String(u.nickname || u.displayId || data.nickname || data.uniqueId || "зрител"),
    pic:   String(u.profilePicture?.url?.[0] || u.avatarThumb?.urlList?.[0] || ""),
    text:  String(data.content ?? data.comment ?? "")
  };
}
const readViewers = d => Number(d.totalUser || d.total || d.viewerCount || 0) || 0;

let chatSeen = 0;

async function disconnectTikTok(){
  clearTimeout(retryTimer); retryTimer = null;
  wanted = "";
  if(!conn) return;
  try{ conn.disconnect(); }catch(e){}
  conn = null; currentUser = ""; viewers = 0;
}

async function connectTikTok(rawName, isRetry = false){
  const username = String(rawName || "").trim().replace(/^@/, "");
  if(!username){ broadcast({ type:"error", message:"Липсва потребителско име." }); return; }

  await disconnectTikTok();
  wanted = username;
  if(!isRetry) saveUser(username);
  broadcast({ type:"info", message:`Свързване към @${username}…` });
  console.log(`\n→ Свързване към @${username} …`);

  const c = new TikTokLiveConnection(username, { processInitialData: false });

  c.on(WebcastEvent.CHAT, data => {
    const m = readChat(data);
    chatSeen++;

    // ако текстът излиза празен, показваме какво реално идва
    if(!m.text && chatSeen <= 3){
      console.log("  ! Коментар без текст. Полета:", Object.keys(data || {}).join(", "));
      return;
    }
    console.log(`  💬 ${m.nick}: ${m.text}`);
    if(m.text) broadcast(m);
  });
  c.on(WebcastEvent.ROOM_USER, data => {
    const n = readViewers(data);
    if(n){ viewers = n; broadcast(status()); }
  });
  c.on(WebcastEvent.STREAM_END, () => {
    console.log("← Streamът приключи.");
    broadcast({ type:"info", message:"Streamът приключи." });
    disconnectTikTok().then(()=> broadcast(status()));
  });
  c.on(ControlEvent.DISCONNECTED, () => {
    console.log("← Връзката с TikTok прекъсна.");
    currentUser = "";
    broadcast(status());
  });
  c.on(ControlEvent.ERROR, err => {
    const m = err?.exception?.message || err?.message || err?.info || String(err);
    console.error("  ! " + m);
  });

  try{
    await c.connect();
    clearTimeout(retryTimer); retryTimer = null;
    conn = c; currentUser = username;
    console.log(`✓ Свързан към @${username}.`);
    console.log(`  Чакам коментари. Всеки ще се изписва тук.`);
    console.log(`  Зрителите просто пишат думата в чата.\n`);
    broadcast(status());

    const beleg = chatSeen;
    setTimeout(() => {
      if(chatSeen === beleg && conn === c){
        console.log(`
  ! От свързването насам не е дошъл нито един коментар.
    Ако в чата се пише, но тук е празно, кажи го - значи проблемът е
    във връзката с TikTok, а не в играта.
`);
      }
    }, 90000);
  }catch(err){
    const msg = err?.message || String(err);
    const offline = /offline|isn't online|not online|not found|room id/i.test(msg);

    // Стриймът често се пуска след играта, а и мрежата понякога капризничи.
    // Затова не се отказваме след един опит — чакаме и пробваме пак, докато
    // не бъде изрично прекъснато или пренасочено към друго име.
    if(wanted === username){
      if(!isRetry){
        console.log(offline
          ? `  @${username} още не е на живо. Чакам и пробвам всеки ${RETRY_SEC} сек…`
          : `  Връзката не стана (${msg}). Пробвам пак всеки ${RETRY_SEC} сек…`);
      }
      broadcast({ type:"info", message: offline
        ? `@${username} още не е на живо — чакам да пуснеш LIVE. Проверявам всеки ${RETRY_SEC} сек.`
        : `Опитвам да се свържа с @${username}… (проверявам всеки ${RETRY_SEC} сек)` });
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => connectTikTok(username, true), RETRY_SEC * 1000);
      return;
    }

    console.error(`✗ Неуспешна връзка към @${username}: ${msg}`);
    broadcast({ type:"error", message:`Грешка при свързване: ${msg}` });
    broadcast(status());
  }
}

wss.on("connection", (ws, req) => {
  ws.isHost = !viaTunnel(req);

  // зрителите през публичния линк получават обикновена игра, без TikTok
  if(!ws.isHost){
    send(ws, { type:"status", connected:false, user:"", viewers:0 });
    return;
  }

  send(ws, status());
  ws.on("message", raw => {
    let msg; try{ msg = JSON.parse(raw.toString()); }catch{ return; }
    if(msg.type === "connect")    connectTikTok(msg.username);
    if(msg.type === "disconnect") disconnectTikTok().then(()=> broadcast(status()));
    if(msg.type === "ping")       send(ws, status());
    if(msg.type === "setup")      writeSetup({ time: msg.time, rounds: msg.rounds, hints: msg.hints });
  });
});

/* ---------- пускане ---------- */
function localIP(){
  for(const list of Object.values(os.networkInterfaces()))
    for(const n of list || [])
      if(n.family === "IPv4" && !n.internal) return n.address;
  return null;
}

/* ---------- публичен линк (само при LINK-ZA-TIKTOK.bat) ----------
   Пуска тунел през Cloudflare, който извежда локалния сървър в интернет
   и връща готов https адрес. Не иска регистрация. Ако не тръгне,
   играта продължава да работи локално както обикновено. */
function startTunnel(){
  let bin;
  try{ bin = require('cloudflared').bin; }
  catch(e){
    console.log("  ! Липсва частта за публичен линк. Пусни START.bat веднъж, за да се достави.\n");
    return;
  }
  if(!fs.existsSync(bin)){
    console.log("  ! Частта за публичен линк не е свалена докрай. Изтрий папката server/node_modules и пусни пак.\n");
    return;
  }

  console.log("  Правя публичен линк, изчакай 5–15 секунди…\n");
  const cf = spawn(bin, ["tunnel", "--url", `http://localhost:${PORT}`], { stdio:["ignore","pipe","pipe"] });

  let found = false;
  const scan = buf => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if(m && !found){
      found = true;
      console.log(`
  ╔════════════════════════════════════════════════════════╗
  ║   ЛИНК ЗА TIKTOK — копирай го оттук:                   ║
  ╚════════════════════════════════════════════════════════╝

     ${m[0]}

  Този линк работи, докато този прозорец е отворен.
  При следващо пускане ще е различен.
`);
    }
  };
  cf.stdout.on("data", scan);
  cf.stderr.on("data", scan);

  cf.on("exit", code => {
    if(!found) console.log(`
  ! Публичният линк не тръгна (код ${code}).
    Играта работи нормално на http://localhost:${PORT}
    Провери интернета си или пробвай пак след малко.
`);
  });
  cf.on("error", err => console.log("  ! Публичният линк не тръгна:", err.message, "\n"));

  process.on("exit", () => { try{ cf.kill(); }catch(e){} });
}

/* Ако портът е зает от друга програма, няма смисъл да се занимава човек
   с търсене на чужди прозорци — просто пробваме следващия свободен порт.
   WebSocketServer препредава същата грешка, затова се заглушава и там. */
wss.on("error", () => {});

let port = PORT;
httpServer.on("error", err => {
  if(err.code === "EADDRINUSE" && port < PORT + 20){
    port++;
    console.log(`  Порт ${port - 1} е зает, пробвам ${port}…`);
    setTimeout(() => httpServer.listen(port), 100);
    return;
  }
  console.log("\n  Сървърът не можа да тръгне:", err.message, "\n");
  process.exit(1);
});

httpServer.listen(port, () => {
  const ip = localIP();
  const PORT = port;              // реално ползваният порт
  const savedUser = readUser();   // името от миналия път
  console.log(`
╔══════════════════════════════════════════════════════╗
║              ПОЗНАЙ 5  —  сървърът работи            ║
╚══════════════════════════════════════════════════════╝

  ЗА TIKTOK STUDIO / OBS — сложи този адрес в "браузър източник":

      http://127.0.0.1:${PORT}/index.html

  (TikTok Studio не приема "localhost", затова е с цифрите)

  За обикновен браузър:  http://localhost:${PORT}
${ip ? `  От телефон в същата мрежа:  http://${ip}:${PORT}\n` : ""}
  ${savedUser ? `Свързва се сам към @${savedUser}. Зрителите просто пишат
  думата в чата — играта сама вижда кой е познал.`
  : `1. Отвори адреса
  2. Напиши името си в полето "TikTok LIVE" и натисни "Свържи"
  3. Зрителите просто пишат думите в чата`}

  ${savedUser ? `ГОТОВИЯТ ТИ ЛИНК — играта тръгва сама и се закача за чата:

      http://127.0.0.1:${PORT}/index.html?tiktok=${savedUser}&start=1&rounds=0`
    : `След първото свързване тук ще излиза готов линк с твоето име.`}

  ВАЖНО: този прозорец трябва да остане отворен.
  Спиране: Ctrl + C
`);
  if(process.env.TUNNEL === "1") startTunnel();

  // щом знаем към кого, няма смисъл да чакаме да се цъка "Свържи"
  const auto = process.argv.slice(2).find(a => !a.startsWith("-")) ||
               process.env.TIKTOK_USER || savedUser;
  if(auto) connectTikTok(auto);
});

process.on("SIGINT", () => { disconnectTikTok(); process.exit(0); });
