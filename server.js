const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const players = {}; 

io.on('connection', (socket) => {
  console.log('Pemain terhubung:', socket.id);

  // PEMBARUAN: Beri nilai awal untuk arah (direction) dan status gerak (isMoving)
  players[socket.id] = { 
      x: 100, 
      y: 100, 
      id: socket.id,
      direction: 'down',
      isMoving: false
  };
  
  socket.emit('currentPlayers', players);
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('setPlayerName', (name) => {
    if (players[socket.id]) {
      players[socket.id].playerName = name;
      io.emit('playerMoved', players[socket.id]); // Siarkan perubahan ke semua orang
    }
  });
  
  // PEMBARUAN: Server sekarang menerima, menyimpan, dan menyiarkan arah hadap!
  socket.on('playerMovement', (movementData) => {
    players[socket.id].x = movementData.x;
    players[socket.id].y = movementData.y;
    players[socket.id].direction = movementData.direction; 
    players[socket.id].isMoving = movementData.isMoving; 

    socket.broadcast.emit('playerMoved', players[socket.id]);
  });

  socket.on('disconnect', () => {
    console.log('Pemain keluar:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
