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
  console.log('Pemain terhubung, menunggu pilihan karakter:', socket.id);

  // BARU: Server mendengarkan pendaftaran (joinGame) dari layar pemilihan
  socket.on('joinGame', (avatarType) => {
      players[socket.id] = { 
          x: 100, 
          y: 100, 
          id: socket.id,
          direction: 'down',
          isMoving: false,
          avatar: avatarType // Menyimpan pilihan: 'boy' atau 'girl'
      };
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
  });

  socket.on('playerMovement', (movementData) => {
      // ... (biarkan isi movement tetap sama persis seperti sebelumnya)
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].direction = movementData.direction; 
      players[socket.id].isMoving = movementData.isMoving; 

      socket.broadcast.emit('playerMoved', players[socket.id]);
  });

  socket.on('disconnect', () => {
      // ... (biarkan isi disconnect tetap sama persis)
      console.log('Pemain keluar:', socket.id);
      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
