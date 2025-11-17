const socket = io(window.location.origin);

// ---------- DOM ----------

// Canvas
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Screens
const screenWelcome = document.getElementById("screen-welcome");
const screenRules = document.getElementById("screen-rules");
const screenGame = document.getElementById("screen-game");

// Welcome screen
const inputName = document.getElementById("inputName");
const inputRoomId = document.getElementById("inputRoomId");
const btnCreateRoom = document.getElementById("btnCreateRoom");
const btnJoinRoom = document.getElementById("btnJoinRoom");
const welcomeError = document.getElementById("welcomeError");

// Rules screen
const btnGoToGame = document.getElementById("btnGoToGame");

// Game HUD
const scoreBlueEl = document.getElementById("scoreBlue");
const scoreRedEl = document.getElementById("scoreRed");
const timerEl = document.getElementById("timer");
const statusText = document.getElementById("statusText");
const roomIdLabel = document.getElementById("roomIdLabel");
const roleLabel = document.getElementById("roleLabel");
const playerNameLabel = document.getElementById("playerNameLabel");

// Scoreboard player names & wrappers (for pop animation)
const bluePlayerNameEl = document.getElementById("bluePlayerName");
const redPlayerNameEl = document.getElementById("redPlayerName");
const blueScoreWrapper = document.getElementById("blueScoreWrapper");
const redScoreWrapper = document.getElementById("redScoreWrapper");

// Support UI
const supportControls = document.getElementById("supportControls");
const supportStatus = document.getElementById("supportStatus");
const supportPrompt = document.getElementById("supportPrompt");
const btnSupportBlue = document.getElementById("btnSupportBlue");
const btnSupportRed = document.getElementById("btnSupportRed");

// Fullscreen
const btnFullscreen = document.getElementById("btnFullscreen");
const gameContainer = document.getElementById("gameContainer");

// Mobile controls
const mobileControls = document.getElementById("mobileControls");
const dpadButtons = document.querySelectorAll(".dpad-btn[data-dir]");
const btnMobileKick = document.getElementById("btnMobileKick");
const btnMobileSprint = document.getElementById("btnMobileSprint");
const btnMobileBump = document.getElementById("btnMobileBump");

// ---------- Audio ----------
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioCtx();
  } else if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playWhistle(long = false) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(1800, audioCtx.currentTime);
  o.frequency.linearRampToValueAtTime(1300, audioCtx.currentTime + 0.15);
  g.gain.setValueAtTime(0.0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0.32, audioCtx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(
    0.0001,
    audioCtx.currentTime + (long ? 0.7 : 0.35)
  );
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + (long ? 0.7 : 0.35));
}

function playCrowdCheer() {
  if (!audioCtx) return;
  const bufferSize = audioCtx.sampleRate * 0.7;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] =
      (Math.random() * 2 - 1) *
      (1 - i / bufferSize) *
      (i > bufferSize * 0.1 ? 0.6 : 0.2);
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const g = audioCtx.createGain();
  g.gain.value = 0.35;
  noise.connect(g);
  g.connect(audioCtx.destination);
  noise.start();
}

// Wake audio on first interaction
["click", "keydown", "touchstart"].forEach((ev) =>
  window.addEventListener(ev, () => ensureAudio(), { once: true })
);

// ---------- Game state ----------
let clientId = null;
let myTeam = "spectator";
let myRole = "spectator";
let myName = "";
let myRoomId = "";
let field = { width: canvas.width, height: canvas.height };
let matchDuration = 180;

// Input state
let keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  kick: false,
  sprint: false,
  bump: false,
};

let latestState = {
  players: [],
  ball: { x: field.width / 2, y: field.height / 2 },
  score: { blue: 0, red: 0 },
  matchTime: 180,
  running: false,
  lastEvent: null,
  eventId: 0,
  supporters: { blue: 0, red: 0 },
};

// Overlays & replay
let overlayText = "";
let overlayUntil = 0;
let lastSeenEventId = 0;
let ballHistory = [];
let replayPathUntil = 0;
let lastScore = { blue: 0, red: 0 };
let introShownOnce = false;

// ---------- Mobile detection ----------
function isProbablyMobile() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

if (isProbablyMobile()) {
  document.body.classList.add("is-mobile");
}

// ---------- Screen helpers ----------
function setScreen(name) {
  screenWelcome.classList.remove("active");
  screenRules.classList.remove("active");
  screenGame.classList.remove("active");

  if (name === "welcome") screenWelcome.classList.add("active");
  else if (name === "rules") screenRules.classList.add("active");
  else if (name === "game") screenGame.classList.add("active");
}

// ---------- Welcome actions ----------
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

btnCreateRoom.onclick = () => {
  const name = inputName.value.trim();
  let roomId = inputRoomId.value.trim();
  welcomeError.textContent = "";

  if (!name) {
    welcomeError.textContent = "Please enter your name.";
    return;
  }
  if (!roomId) {
    roomId = generateRoomId();
    inputRoomId.value = roomId;
  }

  socket.emit("join_room", { roomId, name });
};

btnJoinRoom.onclick = () => {
  const name = inputName.value.trim();
  const roomId = inputRoomId.value.trim();
  welcomeError.textContent = "";

  if (!name) {
    welcomeError.textContent = "Please enter your name.";
    return;
  }
  if (!roomId) {
    welcomeError.textContent = "Please enter the Room ID to join.";
    return;
  }

  socket.emit("join_room", { roomId, name });
};

btnGoToGame.onclick = () => {
  setScreen("game");
};

// ---------- Spectator support ----------
btnSupportBlue.onclick = () => {
  socket.emit("set_support", { team: "blue" });
};
btnSupportRed.onclick = () => {
  socket.emit("set_support", { team: "red" });
};

// ---------- Fullscreen ----------
btnFullscreen.onclick = () => {
  if (!document.fullscreenElement) {
    gameContainer.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
};

// ---------- Socket handlers ----------
socket.on("join_error", (msg) => {
  welcomeError.textContent = msg || "Failed to join room.";
});

socket.on("init", (data) => {
  clientId = data.id;
  myTeam = data.team;
  myRole = data.role;
  myName = data.name;
  myRoomId = data.roomId;
  field = data.field || field;
  matchDuration = data.matchDuration || matchDuration;

  roomIdLabel.textContent = myRoomId;
  playerNameLabel.textContent = myName || "-";
  roleLabel.textContent =
    myRole === "player"
      ? `PLAYER (${myTeam.toUpperCase()})`
      : "SPECTATOR";

  if (myRole === "player") {
    roleLabel.classList.add("role-player");
  } else {
    roleLabel.classList.remove("role-player");
  }

  // 🔹 Spectators: see support UI + buttons
  // 🔹 Players: support block hidden (they already know their side)
  // Always show support UI (players + spectators)
// Spectators actually use it, players can just ignore it
  supportControls.style.display = "flex";


  // Status text is visible for *everyone* (players + spectators)
  statusText.textContent =
    myRole === "player"
      ? `Waiting for match to start...`
      : `You are a spectator in Room ${myRoomId}. Choose a side to support.`;

  setScreen("rules");
});

// State updates
socket.on("state", (state) => {
  latestState = state;

  // Scores
  scoreBlueEl.textContent = state.score.blue;
  scoreRedEl.textContent = state.score.red;
  timerEl.textContent = formatTime(state.matchTime);

  // Player names for scoreboard
  const bluePlayer = state.players.find((p) => p.team === "blue");
  const redPlayer = state.players.find((p) => p.team === "red");
  if (bluePlayerNameEl) {
    bluePlayerNameEl.textContent = bluePlayer
      ? bluePlayer.name || "BLUE"
      : "BLUE";
  }
  if (redPlayerNameEl) {
    redPlayerNameEl.textContent = redPlayer
      ? redPlayer.name || "RED"
      : "RED";
  }

  // Score pop animation
  if (state.score.blue !== lastScore.blue) {
    triggerScorePop("blue");
  }
  if (state.score.red !== lastScore.red) {
    triggerScorePop("red");
  }
  lastScore = { ...state.score };

  // Ball path history (for short replay)
  const now = performance.now();
  ballHistory.push({ x: state.ball.x, y: state.ball.y, t: now });
  const cutoff = now - 3000;
  while (ballHistory.length && ballHistory[0].t < cutoff) {
    ballHistory.shift();
  }

  // Supporters
  if (state.supporters) {
    supportStatus.textContent = `Fans: Blue ${state.supporters.blue} | Red ${state.supporters.red}`;
  }

  handleEvents(state);

  // 🔹 Status line that *everyone* sees
  if (!state.running) {
    if (state.matchTime <= 0) {
      const { blue, red } = state.score;
      if (blue > red) {
        statusText.textContent = `FULL-TIME: BLUE wins ${blue} - ${red}`;
      } else if (red > blue) {
        statusText.textContent = `FULL-TIME: RED wins ${blue} - ${red}`;
      } else {
        statusText.textContent = `FULL-TIME: Draw ${blue} - ${red}`;
      }
    } else {
      statusText.textContent = "Match paused or waiting for both players.";
    }
  } else {
    const halfLabel =
      state.matchTime > matchDuration / 2 ? "1st Half" : "2nd Half";
    statusText.textContent = `Match running • ${halfLabel}`;
  }
});

// Score pop helper
function triggerScorePop(side) {
  const el =
    side === "blue" ? blueScoreWrapper : side === "red" ? redScoreWrapper : null;
  if (!el) return;
  el.classList.remove("score-pop");
  void el.offsetWidth; // force reflow
  el.classList.add("score-pop");
  setTimeout(() => {
    el.classList.remove("score-pop");
  }, 400);
}

// Events: kickoff / goal / halftime / fulltime
function handleEvents(state) {
  if (!state.lastEvent || !state.eventId) return;
  if (state.eventId === lastSeenEventId) return;
  lastSeenEventId = state.eventId;

  ensureAudio();
  const ev = state.lastEvent;

  if (ev.type === "kickoff") {
    const bluePlayer = state.players.find((p) => p.team === "blue");
    const redPlayer = state.players.find((p) => p.team === "red");
    const blueName = bluePlayer ? bluePlayer.name || "BLUE" : "BLUE";
    const redName = redPlayer ? redPlayer.name || "RED" : "RED";

    overlayText = `${blueName} vs ${redName}`;
    overlayUntil = Date.now() + (introShownOnce ? 1500 : 2500);
    introShownOnce = true;
    playWhistle(false);
  } else if (ev.type === "goal") {
    const scorer = state.players.find((p) => p.team === ev.team);
    const scorerName = scorer
      ? scorer.name || ev.team.toUpperCase()
      : ev.team.toUpperCase();
    overlayText = `GOAL!!! ${scorerName}`;
    overlayUntil = Date.now() + 3000;
    replayPathUntil = Date.now() + 2500;
    playCrowdCheer();
    playWhistle(false);
  } else if (ev.type === "halftime") {
    overlayText = "HALF-TIME";
    overlayUntil = Date.now() + 3000;
    playWhistle(true);
  } else if (ev.type === "fulltime") {
    if (ev.winner === "draw") {
      overlayText = "FULL-TIME • DRAW";
    } else {
      overlayText = `FULL-TIME • ${ev.winner.toUpperCase()} WINS!`;
    }
    overlayUntil = Date.now() + 4000;
    playWhistle(true);
  }
}

// ---------- Keyboard input ----------
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "w" || e.key === "ArrowUp") keys.up = true;
  if (e.key === "s" || e.key === "ArrowDown") keys.down = true;
  if (e.key === "a" || e.key === "ArrowLeft") keys.left = true;
  if (e.key === "d" || e.key === "ArrowRight") keys.right = true;
  if (e.key === " ") {
    e.preventDefault();
    keys.kick = true;
  }
  if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
    keys.sprint = true;
  }
  if (e.key === "f" || e.key === "F") {
    keys.bump = true;
  }
  if (e.key === "r" || e.key === "R") {
    socket.emit("restart");
  }
  sendInput();
});

window.addEventListener("keyup", (e) => {
  if (e.key === "w" || e.key === "ArrowUp") keys.up = false;
  if (e.key === "s" || e.key === "ArrowDown") keys.down = false;
  if (e.key === "a" || e.key === "ArrowLeft") keys.left = false;
  if (e.key === "d" || e.key === "ArrowRight") keys.right = false;
  if (e.key === " ") keys.kick = false;
  if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
    keys.sprint = false;
  }
  if (e.key === "f" || e.key === "F") {
    keys.bump = false;
  }
  sendInput();
});

// ---------- Mobile controls wiring ----------

function setDirectionFromDpad(dir, isDown) {
  if (dir === "up") keys.up = isDown;
  if (dir === "down") keys.down = isDown;
  if (dir === "left") keys.left = isDown;
  if (dir === "right") keys.right = isDown;
  sendInput();
}

dpadButtons.forEach((btn) => {
  const dir = btn.dataset.dir;

  const pressStart = (ev) => {
    ev.preventDefault();
    setDirectionFromDpad(dir, true);
  };
  const pressEnd = (ev) => {
    ev.preventDefault();
    setDirectionFromDpad(dir, false);
  };

  btn.addEventListener("touchstart", pressStart);
  btn.addEventListener("touchend", pressEnd);
  btn.addEventListener("touchcancel", pressEnd);
  btn.addEventListener("mousedown", pressStart);
  btn.addEventListener("mouseup", pressEnd);
  btn.addEventListener("mouseleave", pressEnd);
});

// Kick tap
if (btnMobileKick) {
  const doKick = (e) => {
    e.preventDefault();
    keys.kick = true;
    sendInput();
    setTimeout(() => {
      keys.kick = false;
      sendInput();
    }, 120);
  };
  btnMobileKick.addEventListener("touchstart", doKick);
  btnMobileKick.addEventListener("click", doKick);
}

// Sprint hold
if (btnMobileSprint) {
  const startSprint = (e) => {
    e.preventDefault();
    keys.sprint = true;
    sendInput();
  };
  const endSprint = (e) => {
    e && e.preventDefault();
    keys.sprint = false;
    sendInput();
  };

  btnMobileSprint.addEventListener("touchstart", startSprint);
  btnMobileSprint.addEventListener("touchend", endSprint);
  btnMobileSprint.addEventListener("touchcancel", endSprint);
  btnMobileSprint.addEventListener("mousedown", startSprint);
  btnMobileSprint.addEventListener("mouseup", endSprint);
  btnMobileSprint.addEventListener("mouseleave", endSprint);
}

// Bump tap
if (btnMobileBump) {
  const doBump = (e) => {
    e.preventDefault();
    keys.bump = true;
    sendInput();
    setTimeout(() => {
      keys.bump = false;
      sendInput();
    }, 120);
  };
  btnMobileBump.addEventListener("touchstart", doBump);
  btnMobileBump.addEventListener("click", doBump);
}

// Send input state
function sendInput() {
  socket.emit("input", keys);
}

// ---------- Render loop ----------
function render() {
  const state = latestState;
  const w = canvas.width;
  const h = canvas.height;

  // Pitch stripes
  ctx.clearRect(0, 0, w, h);
  const stripes = 10;
  const stripeWidth = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#065f46" : "#047857";
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, h);
  }

  // Center line & circle
  ctx.strokeStyle = "#bbf7d0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
  ctx.stroke();

  // Penalty boxes
  const boxWidth = 120;
  const boxHeight = 200;
  ctx.strokeRect(0, h / 2 - boxHeight / 2, boxWidth, boxHeight);
  ctx.strokeRect(w - boxWidth, h / 2 - boxHeight / 2, boxWidth, boxHeight);

  // Goals
  const goalHeight = h * 0.4;
  const goalTop = (h - goalHeight) / 2;
  ctx.fillStyle = "#fefce8";
  ctx.fillRect(0, goalTop, 6, goalHeight);
  ctx.fillRect(w - 6, goalTop, 6, goalHeight);

  // Shadows for players
  state.players.forEach((p) => {
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 10, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Shadow for ball
  ctx.fillStyle = "rgba(15,23,42,0.6)";
  ctx.beginPath();
  ctx.ellipse(state.ball.x, state.ball.y + 6, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ball
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#111827";
  ctx.stroke();

  // Players (with names + YOU tag)
  state.players.forEach((p) => {
    const isMe = p.id === clientId;
    const color = p.team === "blue" ? "#3b82f6" : "#f97373";
    const outline = isMe ? "#fefce8" : "#0f172a";

    // Body
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = outline;
    ctx.lineWidth = isMe ? 3 : 2;
    ctx.stroke();

    // Name above
    const label = p.name || (p.team === "blue" ? "BLUE" : p.team === "red" ? "RED" : "");
    if (label) {
      ctx.font = "11px system-ui";
      ctx.fillStyle = isMe ? "#fef9c3" : "#e5e7eb";
      const textWidth = ctx.measureText(label).width;
      ctx.fillText(label, p.x - textWidth / 2, p.y - 20);
    }

    // YOU tag
    if (isMe) {
      ctx.font = "10px system-ui";
      ctx.fillStyle = "#bfdbfe";
      const youWidth = ctx.measureText("YOU").width;
      ctx.fillText("YOU", p.x - youWidth / 2, p.y + 26);
    }
  });

  // Ball trajectory after goal
  if (replayPathUntil && Date.now() < replayPathUntil) {
    ctx.save();
    ctx.strokeStyle = "rgba(250,250,249,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    const now = performance.now();
    const cutoff = now - 2000;
    for (const pt of ballHistory) {
      if (pt.t < cutoff) continue;
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    if (started) ctx.stroke();
    ctx.restore();
  }

  // Sprint bar for local player
  const me = state.players.find((p) => p.id === clientId);
  if (me && myRole === "player") {
    const energy = me.energy ?? 0;
    const barWidth = 120;
    const barX = 20;
    const barY = h - 24;
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    ctx.fillRect(barX - 2, barY - 10, barWidth + 4, 14);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(barX, barY - 8, barWidth * energy, 10);
    ctx.strokeStyle = "rgba(15,23,42,0.9)";
    ctx.strokeRect(barX - 2, barY - 10, barWidth + 4, 14);
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "10px system-ui";
    ctx.fillText("SPRINT (SHIFT)", barX, barY - 12);
  }

  // Minimap (top-right)
  const miniW = 160;
  const miniH = 90;
  const miniX = w - miniW - 12;
  const miniY = 12;
  const sx = miniW / w;
  const sy = miniH / h;

  ctx.save();
  ctx.fillStyle = "rgba(15,23,42,0.85)";
  ctx.fillRect(miniX, miniY, miniW, miniH);
  ctx.strokeStyle = "rgba(148,163,184,0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(miniX, miniY, miniW, miniH);

  // Center line on minimap
  ctx.strokeStyle = "rgba(148,163,184,0.5)";
  ctx.beginPath();
  ctx.moveTo(miniX + miniW / 2, miniY);
  ctx.lineTo(miniX + miniW / 2, miniY + miniH);
  ctx.stroke();

  // Players on minimap
  state.players.forEach((p) => {
    const isMe = p.id === clientId;
    const px = miniX + p.x * sx;
    const py = miniY + p.y * sy;
    ctx.beginPath();
    ctx.fillStyle = p.team === "blue" ? "#60a5fa" : "#fb7185";
    ctx.arc(px, py, isMe ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Ball on minimap
  const bx = miniX + state.ball.x * sx;
  const by = miniY + state.ball.y * sy;
  ctx.beginPath();
  ctx.fillStyle = "#fde68a";
  ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Overlay (intro/goal/half/full)
  if (overlayText && Date.now() < overlayUntil) {
    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
    ctx.fillRect(w * 0.15, h * 0.35, w * 0.7, h * 0.3);
    ctx.strokeStyle = "rgba(250, 250, 249, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.15, h * 0.35, w * 0.7, h * 0.3);

    ctx.fillStyle = "#f9fafb";
    ctx.font = "32px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(overlayText, w / 2, h / 2);
    ctx.restore();
  }

  requestAnimationFrame(render);
}

function formatTime(t) {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

render();
