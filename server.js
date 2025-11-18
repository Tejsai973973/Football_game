const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ---- Game constants ----
const FIELD_WIDTH = 800;
const FIELD_HEIGHT = 450;
const TICK_RATE = 60; // 60 updates per second
const MATCH_DURATION = 180; // seconds (3 min)
const HALF_TIME = MATCH_DURATION / 2;

const PLAYER_RADIUS = 14;
const PLAYER_SPEED = 0.9;
const BALL_RADIUS = 8;
const BUMP_RANGE = PLAYER_RADIUS * 2.2;

// ---- Rooms ----
// room: {
//   id,
//   players: { socketId -> playerObj },
//   spectators: { socketId -> spectatorObj },
//   ball, score, matchTime, running,
//   halfTimeTriggered, secondHalf,
//   lastEvent, eventId,
//   lastTickTime
// }
const rooms = new Map();

// ---- Room helpers ----
function createRoom(roomId) {
  const room = {
    id: roomId,
    players: {},
    spectators: {},
    ball: {
      x: FIELD_WIDTH / 2,
      y: FIELD_HEIGHT / 2,
      vx: 0,
      vy: 0,
    },
    score: { blue: 0, red: 0 },
    matchTime: MATCH_DURATION,
    running: false,
    halfTimeTriggered: false,
    secondHalf: false,
    lastEvent: null,
    eventId: 0,
    lastTickTime: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function newEvent(room, event) {
  room.eventId += 1;
  room.lastEvent = { id: room.eventId, ...event };
}

function pauseFor(room, seconds) {
  room.running = false;
  setTimeout(() => {
    if (room.matchTime > 0) {
      room.running = true;
    }
  }, seconds * 1000);
}

function resetBall(room) {
  room.ball.x = FIELD_WIDTH / 2;
  room.ball.y = FIELD_HEIGHT / 2;
  room.ball.vx = 0;
  room.ball.vy = 0;
}

function resetPlayersPositions(room) {
  const bluePlayers = Object.values(room.players).filter(
    (p) => p.team === "blue"
  );
  const redPlayers = Object.values(room.players).filter(
    (p) => p.team === "red"
  );

  const baseY = FIELD_HEIGHT / 2;
  const spacing = 40;

  bluePlayers.forEach((p, idx) => {
    const sideFactor = room.secondHalf ? 1 : -1; // swap side in 2nd half
    p.x = FIELD_WIDTH / 2 + sideFactor * 60;
    p.y = baseY + (idx - (bluePlayers.length - 1) / 2) * spacing;
    p.vx = 0;
    p.vy = 0;
    p.sprintEnergy = p.sprintEnergy ?? 1;
    p.bumpCooldown = p.bumpCooldown ?? 0;
  });

  redPlayers.forEach((p, idx) => {
    const sideFactor = room.secondHalf ? -1 : 1;
    p.x = FIELD_WIDTH / 2 + sideFactor * 60;
    p.y = baseY + (idx - (redPlayers.length - 1) / 2) * spacing;
    p.vx = 0;
    p.vy = 0;
    p.sprintEnergy = p.sprintEnergy ?? 1;
    p.bumpCooldown = p.bumpCooldown ?? 0;
  });
}

function resetMatch(room) {
  room.score.blue = 0;
  room.score.red = 0;
  room.matchTime = MATCH_DURATION;
  room.running = true;
  room.halfTimeTriggered = false;
  room.secondHalf = false;
  room.lastEvent = null;
  room.eventId = 0;
  room.lastTickTime = Date.now();
  resetPlayersPositions(room);
  resetBall(room);
  newEvent(room, { type: "kickoff" });
}

function getPlayerCount(room) {
  return Object.keys(room.players).length;
}

// ---- Socket.IO ----
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.data.roomId = null;
  socket.data.role = "spectator";
  socket.data.team = "spectator";
  socket.data.name = "";

  socket.on("join_room", ({ roomId, name }) => {
    if (!roomId || typeof roomId !== "string") {
      socket.emit("join_error", "Invalid room ID.");
      return;
    }
    if (!name || typeof name !== "string") {
      socket.emit("join_error", "Please enter your name.");
      return;
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom(roomId);
    }

    // Determine role (player or spectator)
    let role = "spectator";
    let team = "spectator";

    const currentPlayerCount = getPlayerCount(room);
    if (currentPlayerCount < 2) {
      role = "player";
      team = currentPlayerCount === 0 ? "blue" : "red";

      room.players[socket.id] = {
        id: socket.id,
        name,
        team,
        x:
          FIELD_WIDTH / 2 +
          (team === "blue"
            ? room.secondHalf
              ? 1
              : -1
            : room.secondHalf
            ? -1
            : 1) *
            60,
        y: FIELD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        input: {
          up: false,
          down: false,
          left: false,
          right: false,
          kick: false,
          sprint: false,
          bump: false,
        },
        lastKickTime: 0,
        sprintEnergy: 1,
        bumpCooldown: 0,
      };
    } else {
      // spectator
      role = "spectator";
      team = "spectator";
      room.spectators[socket.id] = {
        id: socket.id,
        name,
        supportTeam: null,
      };
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.team = team;
    socket.data.name = name;

    // If we have at least 2 players and match not running, start match
    if (getPlayerCount(room) >= 2 && !room.running) {
      resetMatch(room);
    }

    socket.emit("init", {
      id: socket.id,
      team,
      role,
      name,
      roomId,
      field: { width: FIELD_WIDTH, height: FIELD_HEIGHT },
      matchDuration: MATCH_DURATION,
    });
  });

  socket.on("input", (input) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return; // ignore spectators

    player.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      kick: !!input.kick,
      sprint: !!input.sprint,
      bump: !!input.bump,
    };
  });

  socket.on("set_support", ({ team }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const spec = room.spectators[socket.id];
    if (!spec) return;
    if (team !== "blue" && team !== "red") return;
    spec.supportTeam = team;
  });

  socket.on("restart", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (getPlayerCount(room) >= 2) {
      resetMatch(room);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    delete room.players[socket.id];
    delete room.spectators[socket.id];

    if (getPlayerCount(room) < 2) {
      room.running = false;
      room.matchTime = MATCH_DURATION;
      room.halfTimeTriggered = false;
      room.secondHalf = false;
    }

    if (
      Object.keys(room.players).length === 0 &&
      Object.keys(room.spectators).length === 0
    ) {
      rooms.delete(roomId);
    }
  });
});

// ---- Game loop per room ----
function gameLoopRoom(room) {
  const now = Date.now();
  const dt = (now - room.lastTickTime) / 1000;
  room.lastTickTime = now;

  if (room.running) {
    const prevTime = room.matchTime;
    room.matchTime -= dt;

    // Half-time
    if (
      !room.halfTimeTriggered &&
      prevTime > HALF_TIME &&
      room.matchTime <= HALF_TIME
    ) {
      room.matchTime = HALF_TIME;
      room.halfTimeTriggered = true;
      room.secondHalf = true;
      newEvent(room, { type: "halftime" });
      resetPlayersPositions(room);
      resetBall(room);
      pauseFor(room, 4);
    }

    // Full-time
    if (room.matchTime <= 0) {
      room.matchTime = 0;
      room.running = false;
      const { blue, red } = room.score;
      let winner = "draw";
      if (blue > red) winner = "blue";
      else if (red > blue) winner = "red";
      newEvent(room, { type: "fulltime", winner });
      resetPlayersPositions(room);
      resetBall(room);
    }

    updatePlayers(room, dt);
    updateBall(room, dt);
  }

  // supporters count
  const supporters = { blue: 0, red: 0 };
  for (const spec of Object.values(room.spectators)) {
    if (spec.supportTeam === "blue") supporters.blue++;
    else if (spec.supportTeam === "red") supporters.red++;
  }

  // Broadcast state
  const publicState = {
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      x: p.x,
      y: p.y,
      energy: p.sprintEnergy,
    })),
    ball: room.ball,
    score: room.score,
    matchTime: room.matchTime,
    running: room.running,
    lastEvent: room.lastEvent,
    eventId: room.eventId,
    supporters,
  };

  io.to(room.id).emit("state", publicState);
}

function updatePlayers(room, dt) {
  const friction = 0.9;

  for (const p of Object.values(room.players)) {
    p.bumpCooldown = Math.max(0, p.bumpCooldown - dt);

    let ax = 0,
      ay = 0;
    if (p.input.up) ay -= 1;
    if (p.input.down) ay += 1;
    if (p.input.left) ax -= 1;
    if (p.input.right) ax += 1;

    if (ax !== 0 || ay !== 0) {
      const len = Math.hypot(ax, ay);
      ax /= len;
      ay /= len;
    }

    const isSprinting = p.input.sprint && p.sprintEnergy > 0.1;
    const speedMult = isSprinting ? 1.7 : 1.0;

    p.vx += ax * PLAYER_SPEED * speedMult;
    p.vy += ay * PLAYER_SPEED * speedMult;

    if (isSprinting) {
      p.sprintEnergy = Math.max(0, p.sprintEnergy - 0.5 * dt);
    } else {
      p.sprintEnergy = Math.min(1, p.sprintEnergy + 0.3 * dt);
    }

    p.vx *= friction;
    p.vy *= friction;

    p.x += p.vx;
    p.y += p.vy;

    if (p.x < PLAYER_RADIUS) p.x = PLAYER_RADIUS;
    if (p.x > FIELD_WIDTH - PLAYER_RADIUS)
      p.x = FIELD_WIDTH - PLAYER_RADIUS;
    if (p.y < PLAYER_RADIUS) p.y = PLAYER_RADIUS;
    if (p.y > FIELD_HEIGHT - PLAYER_RADIUS)
      p.y = FIELD_HEIGHT - PLAYER_RADIUS;

    // bump
    if (p.input.bump && p.bumpCooldown <= 0) {
      for (const other of Object.values(room.players)) {
        if (other.id === p.id || other.team === p.team) continue;
        const dx = other.x - p.x;
        const dy = other.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < BUMP_RANGE) {
          const nx = dx / dist;
          const ny = dy / dist;
          const IMPULSE = 5;
          other.vx += nx * IMPULSE;
          other.vy += ny * IMPULSE;

          const bx = room.ball.x - other.x;
          const by = room.ball.y - other.y;
          const bdist = Math.hypot(bx, by);
          if (bdist < PLAYER_RADIUS + BALL_RADIUS + 4) {
            const bnx = bx / (bdist || 1);
            const bny = by / (bdist || 1);
            room.ball.vx += bnx * 4;
            room.ball.vy += bny * 4;
          }

          p.bumpCooldown = 1.2;
          newEvent(room, { type: "bump", team: p.team });
          break;
        }
      }
    }

    // kick
    if (p.input.kick) {
      const now = Date.now();
      if (now - p.lastKickTime > 300) {
        tryKickBall(room, p);
        p.lastKickTime = now;
      }
    }
  }
}

function tryKickBall(room, p) {
  const dx = room.ball.x - p.x;
  const dy = room.ball.y - p.y;
  const dist = Math.hypot(dx, dy);
  const maxDist = PLAYER_RADIUS + BALL_RADIUS + 8;
  if (dist <= maxDist) {
    let dirX, dirY;

    if (p.team === "blue") {
      dirX = room.secondHalf ? -1 : 1;
      dirY = Math.random() * 0.4 - 0.2;
    } else if (p.team === "red") {
      dirX = room.secondHalf ? 1 : -1;
      dirY = Math.random() * 0.4 - 0.2;
    } else {
      dirX = dx;
      dirY = dy;
    }

    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;
    const KICK_POWER = 6;

    room.ball.vx = dirX * KICK_POWER;
    room.ball.vy = dirY * KICK_POWER;
    newEvent(room, { type: "kick", team: p.team });
  }
}

// ---- Ball: free-flow, walls, goals, and continuous collision with players ----
function updateBall(room, dt) {
  const b = room.ball;
  const friction = 0.985;

  // Previous position (for continuous collision)
  const oldX = b.x;
  const oldY = b.y;

  // Move ball
  b.x += b.vx;
  b.y += b.vy;

  // Friction (same as before)
  b.vx *= friction;
  b.vy *= friction;

  if (Math.abs(b.vx) < 0.02) b.vx = 0;
  if (Math.abs(b.vy) < 0.02) b.vy = 0;

  // Top / bottom walls
  if (b.y < BALL_RADIUS) {
    b.y = BALL_RADIUS;
    b.vy *= -0.8;
  }
  if (b.y > FIELD_HEIGHT - BALL_RADIUS) {
    b.y = FIELD_HEIGHT - BALL_RADIUS;
    b.vy *= -0.8;
  }

  // Goals / side walls
  const goalTop = FIELD_HEIGHT * 0.3;
  const goalBottom = FIELD_HEIGHT * 0.7;

  // LEFT side
  if (b.x < BALL_RADIUS) {
    if (b.y > goalTop && b.y < goalBottom) {
      const scoringTeam = room.secondHalf ? "blue" : "red";
      room.score[scoringTeam] += 1;
      newEvent(room, { type: "goal", team: scoringTeam });
      resetPlayersPositions(room);
      resetBall(room);
      pauseFor(room, 3);
      return;
    } else {
      b.x = BALL_RADIUS;
      b.vx *= -0.8;
    }
  }

  // RIGHT side
  if (b.x > FIELD_WIDTH - BALL_RADIUS) {
    if (b.y > goalTop && b.y < goalBottom) {
      const scoringTeam = room.secondHalf ? "red" : "blue";
      room.score[scoringTeam] += 1;
      newEvent(room, { type: "goal", team: scoringTeam });
      resetPlayersPositions(room);
      resetBall(room);
      pauseFor(room, 3);
      return;
    } else {
      b.x = FIELD_WIDTH - BALL_RADIUS;
      b.vx *= -0.8;
    }
  }

  // ===== Continuous collision with players (no attraction, free flow) =====
  const moveX = b.x - oldX;
  const moveY = b.y - oldY;
  const moveLenSq = moveX * moveX + moveY * moveY;
  const EPS = 1e-6;

  for (const p of Object.values(room.players)) {
    // exact touch radius
    const R = PLAYER_RADIUS + BALL_RADIUS;

    // if ball barely moved: overlap check
    if (moveLenSq < EPS) {
      const dx0 = b.x - p.x;
      const dy0 = b.y - p.y;
      const dist0 = Math.hypot(dx0, dy0);
      if (dist0 > 0 && dist0 < R) {
        const nx0 = dx0 / dist0;
        const ny0 = dy0 / dist0;
        const overlap0 = R - dist0;

        // push ball out
        b.x += nx0 * overlap0;
        b.y += ny0 * overlap0;

        // add same kind of outward boost as your old code
        const pvx0 = p.vx || 0;
        const pvy0 = p.vy || 0;
        b.vx += nx0 * (1.4 + Math.abs(pvx0) * 0.25);
        b.vy += ny0 * (1.4 + Math.abs(pvy0) * 0.25);
      }
      continue;
    }

    // segment-circle test (ball path old -> new vs player circle)
    const segX = moveX;
    const segY = moveY;
    const toPlayerX = p.x - oldX;
    const toPlayerY = p.y - oldY;

    let t = (toPlayerX * segX + toPlayerY * segY) / moveLenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    const closestX = oldX + segX * t;
    const closestY = oldY + segY * t;

    const dx = closestX - p.x;
    const dy = closestY - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist < R) {
      // normal from player to collision point
      const nx = dist === 0 ? 1 : dx / dist;
      const ny = dist === 0 ? 0 : dy / dist;
      const overlap = R - dist;

      // place ball right at contact point + push it a bit out
      b.x = closestX + nx * overlap;
      b.y = closestY + ny * overlap;

      // add outward burst like your old collision
      const pvx = p.vx || 0;
      const pvy = p.vy || 0;
      b.vx += nx * (1.4 + Math.abs(pvx) * 0.25);
      b.vy += ny * (1.4 + Math.abs(pvy) * 0.25);
    }
  }
}

// Global loop over all rooms
setInterval(() => {
  for (const room of rooms.values()) {
    gameLoopRoom(room);
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
