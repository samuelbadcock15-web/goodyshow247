const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Explicitly serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const players = {};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  players[socket.id] = {
    id: socket.id,
    x: 0, y: 0.44, z: 0,
    yaw: 0,
    name: "Guest"
  };

  io.emit('update_players', players);

  socket.on('player_move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].yaw = data.yaw;
      players[socket.id].name = data.name || "Guest";
      
      socket.broadcast.emit('update_players', players);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('update_players', players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Goody Show Server running on port ${PORT}`);
});
