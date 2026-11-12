const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Explicitly serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const players = {};
let hostSocketId = null;

function createInitialRoomState() {
  return {
    studioRoomCode: Math.floor(1000 + Math.random() * 9000).toString(),
    studioPower: false,
    gameState: "MODE_PROMPT",
    isSoloMode: false,
    isVsGoodyMode: false,
    goodyPlayerSlot: null,
    soloPlayerId: null,
    activePlayer: "goody-contestant-1",
    p1Index: 0,
    p2Index: 0,
    p1RollVal: null,
    p2RollVal: null,
    isDiceRollingP1: false,
    isDiceRollingP2: false,
    diceCountdown: 10,
    isDiceTimerActive: false,
    matchTimerSeconds: 20 * 60,
    isTimeExpired: false,
    activeQuestion: null,
    activeRecap: null,
    stageSelectedOption: null,
    stageOptionStatus: null,
    questionTimer: 0,
    isQuestionTimerActive: false,
    isTieBreakerActive: false,
    contestantNames: {
      "goody-contestant-1": "Player 1",
      "goody-contestant-2": "Player 2"
    },
    contestantCities: {
      "goody-contestant-1": "London",
      "goody-contestant-2": "Nottingham"
    },
    p1ControllerSocketId: null,
    p2ControllerSocketId: null
  };
}

let roomState = createInitialRoomState();

const PLUSHIE_COLORS = [
  0x00f0ff, 0xff7675, 0x55efc4, 0xffbe76, 0xa29bfe,
  0xfd79a8, 0xf6e58d, 0x48dbfb, 0xff9ff3, 0x74b9ff
];

function electNewHostIfNeeded() {
  const activeIds = Object.keys(players);
  if (activeIds.length === 0) {
    hostSocketId = null;
    roomState = createInitialRoomState();
    console.log("Studio empty — reset to standby.");
    return;
  }

  if (!hostSocketId || !players[hostSocketId]) {
    // Pick next available player (randomized among remaining players)
    const randomIndex = Math.floor(Math.random() * activeIds.length);
    hostSocketId = activeIds[randomIndex];
    players[hostSocketId].isHost = true;

    console.log(`Host migrated to: ${hostSocketId}`);
    io.to(hostSocketId).emit('host_assigned', {
      isHost: true,
      roomState: roomState
    });
    io.emit('host_changed', { hostSocketId });
  }
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const isFirstInRoom = Object.keys(players).length === 0 || !hostSocketId;
  if (isFirstInRoom) {
    hostSocketId = socket.id;
  }

  const assignedColor = PLUSHIE_COLORS[Object.keys(players).length % PLUSHIE_COLORS.length];

  players[socket.id] = {
    id: socket.id,
    x: -1.6 + (Math.random() * 1.6 - 0.8),
    y: 0.44,
    z: -1.0 + (Math.random() * 1.2 - 0.6),
    yaw: 0,
    name: `Guest ${socket.id.slice(0, 4)}`,
    color: assignedColor,
    isHost: socket.id === hostSocketId
  };

  // Send immediate initialization + live 24/7 room snapshot to the newly connected client
  socket.emit('init_session', {
    selfId: socket.id,
    isHost: socket.id === hostSocketId,
    hostSocketId: hostSocketId,
    players: players,
    roomState: roomState
  });

  // Notify everyone else of the new plushie & updated audience count
  io.emit('update_players', players);
  io.emit('audience_count', { count: Object.keys(players).length });

  // Real-time 3D plushie position & rotation sync
  socket.on('player_move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].yaw = data.yaw;
      if (data.name) players[socket.id].name = data.name;

      socket.broadcast.emit('player_moved', players[socket.id]);
    }
  });

  // Active Showrunner (Host) pushes authoritative state updates to server & all viewers
  socket.on('sync_game_state', (newState) => {
    if (socket.id !== hostSocketId) return;
    roomState = { ...roomState, ...newState };
    socket.broadcast.emit('sync_game_state', roomState);
  });

  // Active Showrunner broadcasts Goody AI speech text so all clients animate Goody's face & subtitles
  socket.on('host_speak', (payload) => {
    if (socket.id !== hostSocketId) return;
    socket.broadcast.emit('host_speak', payload);
  });

  // Non-host players can interact with Podium 1, Studio Screen, Dice, and Trivia Answers
  socket.on('client_action', (actionData) => {
    // Allow anyone to claim a podium slot when standing on it
    if (actionData.type === 'CLAIM_PODIUM') {
      if (actionData.slot === 1) {
        roomState.p1ControllerSocketId = socket.id;
        if (players[socket.id]) {
          roomState.contestantNames["goody-contestant-1"] = players[socket.id].name;
        }
      } else if (actionData.slot === 2) {
        roomState.p2ControllerSocketId = socket.id;
        if (players[socket.id]) {
          roomState.contestantNames["goody-contestant-2"] = players[socket.id].name;
        }
      }
      io.emit('sync_game_state', roomState);
    }

    // Forward gameplay input (MODE_SELECT, ROLL_DICE, ANSWER_QUESTION) to the active host
    if (hostSocketId && players[hostSocketId]) {
      io.to(hostSocketId).emit('remote_client_action', {
        fromSocketId: socket.id,
        ...actionData
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const wasHost = (socket.id === hostSocketId);

    if (roomState.p1ControllerSocketId === socket.id) {
      roomState.p1ControllerSocketId = null;
    }
    if (roomState.p2ControllerSocketId === socket.id) {
      roomState.p2ControllerSocketId = null;
    }

    delete players[socket.id];
    io.emit('player_disconnected', { id: socket.id });
    io.emit('update_players', players);
    io.emit('audience_count', { count: Object.keys(players).length });

    if (wasHost) {
      hostSocketId = null;
      electNewHostIfNeeded();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Goody Show Server running on port ${PORT}`);
});
