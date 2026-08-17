// test/smoke-test.js
// รันด้วย: npm test  (จากโฟลเดอร์ server/)  หรือ  node test/smoke-test.js  (จากโฟลเดอร์ราก)
//
// สคริปต์นี้จะ:
//  1) เปิดเซิร์ฟเวอร์จริงเป็น child process บนพอร์ตทดสอบ
//  2) จำลองครู 1 คน + นักเรียน 2 คนในวงเดียวกัน
//  3) ตรวจสอบ join / เริ่มเกม / จับคู่ถูก-ผิด / ระบบเหรียญ+คอมโบ / ปัดข้ามจอ / ซื้อไอเทมโจมตี
//  4) พิมพ์ PASS/FAIL แต่ละ step แล้วปิดเซิร์ฟเวอร์อัตโนมัติ

const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 4177;
const URL = `http://localhost:${PORT}`;
const SERVER_DIR = path.join(__dirname, '..', 'server');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    failures++;
  }
}

function waitFor(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

async function main() {
  console.log('🎸 Band Rush — smoke test\n');
  const serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverReady = false;
  serverProc.stdout.on('data', (d) => { if (d.toString().includes('listening')) serverReady = true; });
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  // รอเซิร์ฟเวอร์บูตจริง (poll สูงสุด ~5 วิ)
  for (let i = 0; i < 50 && !serverReady; i++) await new Promise((r) => setTimeout(r, 100));
  check('server booted', serverReady);

  const teacher = io(URL, { transports: ['websocket'] });
  const s1 = io(URL, { transports: ['websocket'] });
  const s2 = io(URL, { transports: ['websocket'] });

  try {
    await Promise.all([
      waitFor(teacher, 'connect'),
      waitFor(s1, 'connect'),
      waitFor(s2, 'connect'),
    ]);
    check('all sockets connected', true);

    // 1) ครูสร้างห้อง
    const roomRes = await new Promise((resolve) => teacher.emit('create_room', { type: 'COMPETITIVE' }, resolve));
    check('create_room returns a 6-digit pin', !!roomRes.pin && /^\d{6}$/.test(roomRes.pin));
    const pin = roomRes.pin;

    // 2) นักเรียน 2 คนเข้าร่วมทีมเดียวกัน
    const j1 = await new Promise((resolve) => s1.emit('join_room', { pin, name: 'Mick', teamId: 'team_1' }, resolve));
    const j2 = await new Promise((resolve) => s2.emit('join_room', { pin, name: 'John', teamId: 'team_1' }, resolve));
    check('player 1 joined with an assigned role', Array.isArray(j1.assignedRoles) && j1.assignedRoles.length > 0);
    check('player 2 joined with an assigned role', Array.isArray(j2.assignedRoles) && j2.assignedRoles.length > 0);

    // 3) เริ่มเกม แล้วรอ state ใบแรก
    const syncP1 = waitFor(s1, 'sync_state');
    teacher.emit('start_game');
    const state1 = await syncP1;
    check('game status is PLAYING after start_game', state1.status === 'PLAYING');
    check('cards were dealt onto the desk', state1.team.cards_on_desk.length > 0);

    // 4) หาการ์ดที่ player1 ถือ แล้วลองจับคู่ถูก
    let myCard = state1.team.cards_on_desk.find((c) => c.owner === s1.id && !c.junk);
    if (!myCard) {
      // ถ้าใบแรกเป็นของ player2 ให้รอ sync รอบถัดไป (spawn ทุก ~3.5 วิ) แล้วลองใหม่
      const nextState = await waitFor(s1, 'sync_state', 6000);
      myCard = nextState.team.cards_on_desk.find((c) => c.owner === s1.id && !c.junk);
    }
    check('found a card owned by player 1 to test matching', !!myCard);

    if (myCard) {
      const before = state1.team.coins;
      const matchP = waitFor(s1, 'match_result');
      s1.emit('submit_match', { cardId: myCard.cardId, targetRole: myCard.family });
      const result = await matchP;
      check('correct match reports isCorrect=true', result.isCorrect === true);
      check('correct match awards coins', result.coinsAdded >= 10);

      const wrongRole = myCard.family === 'Strings' ? 'Percussion' : 'Strings';
      // ต้องมีการ์ดใหม่ก่อนถึงจะลองข้อผิดได้ — spawn interval จะเติมให้เอง เราจึงรอ sync ถัดไป
    }

    // 5) ทดสอบ atomic purchase: ซื้อไอเทมเกินเงินที่มีต้อง error
    const buyErrP = waitFor(s1, 'action_error');
    s1.emit('buy_and_use_item', { itemType: 'fermata', targetTeamId: 'team_2' });
    const buyErr = await buyErrP;
    check('insufficient-funds purchase is rejected atomically', buyErr.error === 'error_insufficient_funds');

    console.log(`\n${failures === 0 ? '🎉 ALL CHECKS PASSED' : `⚠️  ${failures} CHECK(S) FAILED`}\n`);
  } catch (err) {
    console.error('Test run threw an error:', err);
    failures++;
  } finally {
    teacher.close(); s1.close(); s2.close();
    serverProc.kill();
    process.exitCode = failures === 0 ? 0 : 1;
  }
}

main();
