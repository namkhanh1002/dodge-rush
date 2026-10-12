"use strict";

/* ============================================================
   DODGE RUSH - Logic game 2D né chướng ngại vật
   HTML5 Canvas + JavaScript thuần, không thư viện ngoài.
   - Vòng lặp requestAnimationFrame + delta time
   - Trạng thái: MENU / PLAYING / PAUSED / GAMEOVER
   ============================================================ */

// ---------- Cấu hình hằng số ----------
const CFG = {
  W: 480, // chiều rộng logic của canvas
  H: 720, // chiều cao logic của canvas
  player: {
    w: 44, // bề ngang thân tàu
    h: 48, // chiều cao thân tàu
    speed: 400, // tốc độ di chuyển (pixel/giây)
    bottom: 64, // khoảng cách mép dưới tới đáy canvas
  },
  obstacle: {
    baseSpeed: 170, // tốc độ rơi ban đầu (px/giây)
    speedPerSec: 7, // tốc độ tăng thêm mỗi giây sống sót
    maxSpeed: 520, // tốc độ trần
    h: 28, // chiều cao chướng ngại vật
    minW: 42, // bề ngang nhỏ nhất
    maxW: 118, // bề ngang cơ sở
    maxExtraW: 55, // bề ngang tối đa được cộng thêm theo độ khó
  },
  spawn: {
    base: 0.95, // thời gian giữa 2 lần_spawn ban đầu (giây)
    min: 0.3, // thời gian_spawn trần khó nhất
    shrinkPerSec: 0.012, // mức rút ngắn interval mỗi giây
  },
  scorePerSec: 10, // điểm nhận được mỗi giây sống sót
  particleCap: 420, // giới hạn hạt để tránh rò rỉ bộ nhớ
  keyHigh: "dodgeRushHighScore",
  keySound: "dodgeRushSound",
  keyFps: "dodgeRushFps",
};

const STATE = {
  MENU: "menu",
  PLAYING: "playing",
  PAUSED: "paused",
  OVER: "over",
};

// ---------- Trạng thái toàn cục ----------
let state = STATE.MENU;
let lastTime = 0;
let obstacles = [];
let particles = [];
let stars = [];
let gridOffset = 0;
let spawnTimer = 0;
let thrusterAcc = 0;
let milestone = 0;
let shakeTime = 0;
let shakePower = 0;
let flashTime = 0;

const game = { elapsed: 0, score: 0, best: 0 };
const player = { cx: CFG.W / 2, y: 0, w: CFG.player.w, h: CFG.player.h };
const input = { left: false, right: false, pointer: false, pointerX: 0 };
const fps = { frames: 0, acc: 0, value: 0, shown: false };

// ---------- DOM ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  fps: document.getElementById("fps"),
  menu: document.getElementById("overlay-menu"),
  pause: document.getElementById("overlay-pause"),
  over: document.getElementById("overlay-over"),
  overScore: document.getElementById("over-score"),
  overBest: document.getElementById("over-best"),
  newRecord: document.getElementById("new-record"),
  btnPlay: document.getElementById("btn-play"),
  btnResume: document.getElementById("btn-resume"),
  btnRestart: document.getElementById("btn-restart"),
  btnMenu: document.getElementById("btn-menu"),
  btnPause: document.getElementById("btn-pause"),
  btnSound: document.getElementById("btn-sound"),
  btnFps: document.getElementById("btn-fps"),
};

// ---------- Tiện ích ----------
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function loadNumber(key, fallback) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

function saveNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (_) {
    /* localStorage có thể bị chặn ở chế độ riêng tư - bỏ qua */
  }
}

function loadBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch (_) {
    return fallback;
  }
}

function saveBool(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch (_) {
    /* bỏ qua */
  }
}

// ---------- Âm thanh (Web Audio API - không tệp ngoài) ----------
const Sound = {
  ctx: null,
  enabled: true,

  ensure() {
    if (!this.enabled) return false;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  },

  tone(freq, dur, type, vol, delay, slideTo) {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol || 0.05, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  },

  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case "click":
        this.tone(700, 0.07, "square", 0.045);
        break;
      case "start":
        this.tone(440, 0.09, "square", 0.055);
        this.tone(660, 0.1, "square", 0.055, 0.09);
        this.tone(880, 0.15, "square", 0.055, 0.18);
        break;
      case "crash":
        this.tone(220, 0.45, "sawtooth", 0.09, 0, 60);
        this.tone(90, 0.55, "square", 0.08, 0, 40);
        break;
      case "pause":
        this.tone(520, 0.1, "triangle", 0.05);
        break;
      case "resume":
        this.tone(760, 0.1, "triangle", 0.05);
        break;
      case "milestone":
        this.tone(880, 0.08, "square", 0.05);
        this.tone(1175, 0.14, "square", 0.05, 0.08);
        break;
      default:
        break;
    }
  },

  toggle() {
    this.enabled = !this.enabled;
    saveBool(CFG.keySound, this.enabled);
    if (this.enabled) this.play("click");
    return this.enabled;
  },
};

// ---------- Hạt (particles) ----------
function addParticle(x, y, vx, vy, life, size, color, gravity) {
  if (particles.length >= CFG.particleCap) return;
  particles.push({
    x: x,
    y: y,
    vx: vx,
    vy: vy,
    life: life,
    maxLife: life,
    size: size,
    color: color,
    gravity: gravity || 0,
  });
}

function burst(x, y, count, colors, speedMin, speedMax, lifeMin, lifeMax) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(speedMin, speedMax);
    addParticle(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      rand(lifeMin, lifeMax),
      rand(2, 5),
      colors[(Math.random() * colors.length) | 0],
      260
    );
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

// ---------- Sao nền parallax ----------
function makeStars() {
  stars = [];
  for (let i = 0; i < 70; i++) {
    stars.push({
      x: Math.random() * CFG.W,
      y: Math.random() * CFG.H,
      r: rand(1, 2.2),
      spd: rand(12, 55),
      a: rand(0.25, 0.8),
    });
  }
}

function updateStars(dt) {
  gridOffset = (gridOffset + 60 * dt) % 48;
  for (const s of stars) {
    s.y += s.spd * dt;
    if (s.y > CFG.H) {
      s.y = -2;
      s.x = Math.random() * CFG.W;
    }
  }
}

// ---------- Chướng ngại vật ----------
function obstacleSpeed() {
  const t = game.elapsed;
  return Math.min(
    CFG.obstacle.maxSpeed,
    CFG.obstacle.baseSpeed + t * CFG.obstacle.speedPerSec
  );
}

function spawnInterval() {
  const t = game.elapsed;
  return Math.max(
    CFG.spawn.min,
    CFG.spawn.base - t * CFG.spawn.shrinkPerSec
  );
}

function spawnObstacle() {
  const speed = obstacleSpeed() * rand(0.9, 1.15);
  const maxW = Math.min(
    CFG.W * 0.34,
    CFG.obstacle.maxW + Math.min(CFG.obstacle.maxExtraW, game.elapsed * 0.6)
  );
  const w = rand(CFG.obstacle.minW, maxW);
  const h = CFG.obstacle.h;

  // Chọn vị trí ngang không chồng lên chướng ngại vật đang ở gần mép trên
  let x = 0;
  let ok = false;
  for (let tryCount = 0; tryCount < 10; tryCount++) {
    x = rand(0, CFG.W - w);
    ok = !obstacles.some(
      (o) =>
        o.y < 70 &&
        !(x + w + 22 < o.x || x > o.x + o.w + 22)
    );
    if (ok) break;
  }
  if (!ok) return; // bỏ qua lần_spawn này để đảm bảo luôn có lối đi

  obstacles.push({ x: x, y: -h - 8, w: w, h: h, speed: speed });
}

function updateObstacles(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer += spawnInterval();
    if (spawnTimer <= 0) spawnTimer = spawnInterval(); // tránh âm dư
  }
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.y += o.speed * dt;
    if (o.y > CFG.H + 40) obstacles.splice(i, 1); // dọn đối tượng ra khỏi màn hình
  }
}

// ---------- Va chạm ----------
function checkCollision() {
  // Hộp va chạm của tàu được thu nhỏ nhẹ để công bằng hơn
  const px = player.cx - player.w / 2 + 6;
  const py = player.y + 8;
  const pw = player.w - 12;
  const ph = player.h - 14;
  for (const o of obstacles) {
    const ox = o.x + 3;
    const oy = o.y + 3;
    const ow = o.w - 6;
    const oh = o.h - 6;
    if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy) {
      return true;
    }
  }
  return false;
}

// ---------- Nhân vật ----------
function updatePlayer(dt) {
  let vx = 0;
  if (input.left && !input.right) vx = -CFG.player.speed;
  else if (input.right && !input.left) vx = CFG.player.speed;

  if (vx !== 0) {
    player.cx += vx * dt;
  } else if (input.pointer) {
    // Kéo ngón tay: tàu bám theo vị trí cảm ứng với tốc độ cố định
    const diff = input.pointerX - player.cx;
    const step = CFG.player.speed * dt;
    player.cx += clamp(diff, -step, step);
  }

  // Không cho tàu ra ngoài khu vực chơi
  const half = player.w / 2;
  player.cx = clamp(player.cx, half, CFG.W - half);

  // Hạt lửa đẩy liên tục khi đang chơi
  thrusterAcc += dt;
  while (thrusterAcc >= 0.03) {
    thrusterAcc -= 0.03;
    addParticle(
      player.cx + rand(-6, 6),
      player.y + player.h,
      rand(-30, 30),
      rand(50, 130),
      rand(0.25, 0.5),
      rand(1.5, 3.5),
      Math.random() < 0.6 ? "#22d3ee" : "#a855f7",
      -40
    );
  }
}

// ---------- Điểm số & trạng thái chơi ----------
function updatePlaying(dt) {
  game.elapsed += dt;
  game.score = Math.floor(game.elapsed * CFG.scorePerSec);
  ui.score.textContent = String(game.score);

  const newMilestone = Math.floor(game.score / 100);
  if (newMilestone > milestone) {
    milestone = newMilestone;
    Sound.play("milestone");
    burst(player.cx, player.y + player.h / 2, 16, ["#22d3ee", "#a5f3fc"], 60, 180, 0.3, 0.6);
  }

  updatePlayer(dt);
  updateObstacles(dt);

  if (checkCollision()) gameOver();
}

// ---------- Vòng đời game ----------
function showOnly(target) {
  ui.menu.hidden = target !== ui.menu;
  ui.pause.hidden = target !== ui.pause;
  ui.over.hidden = target !== ui.over;
}

function updateHud() {
  ui.best.textContent = String(game.best);
  const canPause = state === STATE.PLAYING || state === STATE.PAUSED;
  ui.btnPause.classList.toggle("is-off", !canPause);
  ui.btnPause.textContent = state === STATE.PAUSED ? "▶" : "⏸";
}

function startGame() {
  // Reset hoàn toàn - không bao giờ bị nhân đôi chướng ngại vật/hạt
  obstacles.length = 0;
  particles.length = 0;
  game.elapsed = 0;
  game.score = 0;
  milestone = 0;
  spawnTimer = 0.5;
  thrusterAcc = 0;
  shakeTime = 0;
  flashTime = 0;
  player.cx = CFG.W / 2;
  input.left = false;
  input.right = false;
  input.pointer = false;

  state = STATE.PLAYING;
  showOnly(null);
  ui.score.textContent = "0";
  updateHud();
  Sound.play("start");
  burst(player.cx, player.y + player.h / 2, 22, ["#22d3ee", "#a855f7", "#ffffff"], 50, 200, 0.3, 0.7);
}

function togglePause() {
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    showOnly(ui.pause);
    Sound.play("pause");
  } else if (state === STATE.PAUSED) {
    state = STATE.PLAYING;
    showOnly(null);
    Sound.play("resume");
  }
  updateHud();
}

function gameOver() {
  state = STATE.OVER;
  showOnly(ui.over);

  const isRecord = game.score > game.best;
  if (isRecord) {
    game.best = game.score;
    saveNumber(CFG.keyHigh, game.best);
  }

  ui.overScore.textContent = String(game.score);
  ui.overBest.textContent = String(game.best);
  ui.newRecord.hidden = !isRecord;
  updateHud();

  shakeTime = 0.4;
  shakePower = 14;
  flashTime = 0.35;
  Sound.play("crash");
  burst(
    player.cx,
    player.y + player.h / 2,
    70,
    ["#22d3ee", "#a855f7", "#ec4899", "#ffffff"],
    90,
    430,
    0.5,
    1.2
  );
}

function backToMenu() {
  state = STATE.MENU;
  obstacles.length = 0;
  particles.length = 0;
  game.elapsed = 0;
  game.score = 0;
  ui.score.textContent = "0";
  input.left = false;
  input.right = false;
  input.pointer = false;
  showOnly(ui.menu);
  updateHud();
}

// ---------- Vẽ ----------
function pathRoundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, CFG.H);
  g.addColorStop(0, "#0a0f22");
  g.addColorStop(1, "#170b2e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CFG.W, CFG.H);

  // Sao rơi chậm
  ctx.fillStyle = "#9be8ff";
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  // Lưới ngang parallax
  ctx.strokeStyle = "rgba(34, 211, 238, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = gridOffset - 48; y < CFG.H; y += 48) {
    ctx.moveTo(0, y);
    ctx.lineTo(CFG.W, y);
  }
  ctx.stroke();
}

function drawPlayer() {
  const cx = player.cx;
  const y = player.y;
  const w = player.w;
  const h = player.h;

  // Lửa đẩy
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const flameLen = 10 + Math.random() * 14;
  const fg = ctx.createLinearGradient(0, y + h - 2, 0, y + h + flameLen + 8);
  fg.addColorStop(0, "rgba(34, 211, 238, 0.95)");
  fg.addColorStop(1, "rgba(168, 85, 247, 0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(cx - 8, y + h - 2);
  ctx.lineTo(cx + 8, y + h - 2);
  ctx.lineTo(cx, y + h + flameLen);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Thân tàu neon
  ctx.save();
  ctx.shadowColor = "#22d3ee";
  ctx.shadowBlur = 18;
  const body = ctx.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, "#a5f3fc");
  body.addColorStop(0.55, "#22d3ee");
  body.addColorStop(1, "#7c3aed");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx - w / 2, y + h);
  ctx.lineTo(cx - w / 4, y + h - 7);
  ctx.lineTo(cx + w / 4, y + h - 7);
  ctx.lineTo(cx + w / 2, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Khoang lái
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.42, 4.5, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawObstacles() {
  for (const o of obstacles) {
    ctx.save();
    ctx.shadowColor = "#ec4899";
    ctx.shadowBlur = 14;
    const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
    g.addColorStop(0, "#f472b6");
    g.addColorStop(1, "#a855f7");
    ctx.fillStyle = g;
    pathRoundRect(o.x, o.y, o.w, o.h, 8);
    ctx.fill();
    ctx.restore();

    // Viển sáng trên bề mặt
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    pathRoundRect(o.x + 4, o.y + 4, o.w - 8, 5, 3);
    ctx.fill();
  }
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBorder() {
  ctx.save();
  ctx.shadowColor = "#22d3ee";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.75)";
  ctx.lineWidth = 2;
  pathRoundRect(2, 2, CFG.W - 4, CFG.H - 4, 12);
  ctx.stroke();
  ctx.restore();
}

function render() {
  ctx.save();

  // Rung màn hình khi va chạm
  if (shakeTime > 0) {
    const k = shakeTime / 0.4;
    ctx.translate(
      (Math.random() - 0.5) * shakePower * k * 2,
      (Math.random() - 0.5) * shakePower * k * 2
    );
  }

  drawBackground();

  if (state !== STATE.MENU) {
    drawObstacles();
    // Vẽ tàu khi đang chơi hoặc tạm dừng; ẩn khi game over (đã nổ thành hạt)
    if (state !== STATE.OVER) drawPlayer();
  }

  drawParticles();
  drawBorder();
  ctx.restore();

  // Chớp đỏ khi va chạm
  if (flashTime > 0) {
    ctx.fillStyle = "rgba(255, 80, 96, " + Math.min(0.5, flashTime) + ")";
    ctx.fillRect(0, 0, CFG.W, CFG.H);
  }
}

// ---------- Vòng lặp game ----------
function loop(now) {
  if (!lastTime) lastTime = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05; // chống "nhảy cóc" khi quay lại tab

  // Thống kê FPS
  fps.frames++;
  fps.acc += dt;
  if (fps.acc >= 0.5) {
    fps.value = Math.round(fps.frames / fps.acc);
    fps.frames = 0;
    fps.acc = 0;
    if (fps.shown) ui.fps.textContent = "FPS " + fps.value;
  }

  if (state === STATE.PLAYING) updatePlaying(dt);
  updateParticles(dt);
  updateStars(dt);
  if (shakeTime > 0) shakeTime -= dt;
  if (flashTime > 0) flashTime -= dt;

  render();
  requestAnimationFrame(loop);
}

// ---------- Canvas & retina ----------
function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(CFG.W * dpr);
  canvas.height = Math.round(CFG.H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------- Điều khiển: bàn phím ----------
function isButtonFocused() {
  return document.activeElement && document.activeElement.tagName === "BUTTON";
}

window.addEventListener("keydown", (e) => {
  const code = e.code;

  // Chặn cuộn trang / chọn chữ khi chơi
  if (code === "ArrowLeft" || code === "ArrowRight" || code === "Space") {
    e.preventDefault();
  }

  if (code === "KeyA" || code === "ArrowLeft") input.left = true;
  if (code === "KeyD" || code === "ArrowRight") input.right = true;

  if (e.repeat) return; // bỏ qua sự kiện lặp khi giữ phím

  if (code === "Space") {
    if (isButtonFocused()) return; // để nút đang chọn tự xử lý
    if (state === STATE.PLAYING || state === STATE.PAUSED) togglePause();
  } else if (code === "Enter") {
    if (isButtonFocused()) return;
    if (state === STATE.MENU || state === STATE.OVER) startGame();
    else if (state === STATE.PAUSED) togglePause();
  }
});

window.addEventListener("keyup", (e) => {
  const code = e.code;
  if (code === "KeyA" || code === "ArrowLeft") input.left = false;
  if (code === "KeyD" || code === "ArrowRight") input.right = false;
});

// ---------- Điều khiển: cảm ứng (chạm và kéo) ----------
function pointerToGameX(e) {
  const rect = canvas.getBoundingClientRect();
  return ((e.clientX - rect.left) / rect.width) * CFG.W;
}

canvas.addEventListener("pointerdown", (e) => {
  if (state !== STATE.PLAYING) return;
  input.pointer = true;
  input.pointerX = pointerToGameX(e);
  if (canvas.setPointerCapture) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      /* bỏ qua */
    }
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (input.pointer) input.pointerX = pointerToGameX(e);
});

window.addEventListener("pointerup", () => {
  input.pointer = false;
});

window.addEventListener("pointercancel", () => {
  input.pointer = false;
});

// ---------- Điều khiển: nút bấm ----------
ui.btnPlay.addEventListener("click", function () {
  this.blur();
  startGame();
});

ui.btnRestart.addEventListener("click", function () {
  this.blur();
  startGame();
});

ui.btnResume.addEventListener("click", function () {
  this.blur();
  togglePause();
});

ui.btnMenu.addEventListener("click", function () {
  this.blur();
  Sound.play("click");
  backToMenu();
});

ui.btnPause.addEventListener("click", function () {
  this.blur();
  if (state === STATE.PLAYING || state === STATE.PAUSED) togglePause();
});

ui.btnSound.addEventListener("click", function () {
  const on = Sound.toggle();
  this.textContent = on ? "🔊" : "🔇";
  this.classList.toggle("is-active", on);
  this.blur();
});

ui.btnFps.addEventListener("click", function () {
  fps.shown = !fps.shown;
  saveBool(CFG.keyFps, fps.shown);
  ui.fps.hidden = !fps.shown;
  this.classList.toggle("is-active", fps.shown);
  this.blur();
});

// Tự tạm dừng khi chuyển tab / thu nhỏ cửa sổ
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === STATE.PLAYING) togglePause();
});

// ---------- Khởi tạo ----------
function init() {
  game.best = loadNumber(CFG.keyHigh, 0);
  Sound.enabled = loadBool(CFG.keySound, true);
  fps.shown = loadBool(CFG.keyFps, false);

  player.y = CFG.H - CFG.player.bottom - player.h;

  ui.best.textContent = String(game.best);
  ui.fps.hidden = !fps.shown;
  ui.btnSound.textContent = Sound.enabled ? "🔊" : "🔇";
  ui.btnSound.classList.toggle("is-active", Sound.enabled);
  ui.btnFps.classList.toggle("is-active", fps.shown);

  makeStars();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  updateHud();
  requestAnimationFrame(loop);
}

init();
