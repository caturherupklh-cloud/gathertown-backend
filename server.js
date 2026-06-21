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
  console.log('Koneksi baru masuk (belum login):', socket.id);

  // KODE BARU: Server menunggu event 'joinGame' dari frontend (membawa paket nama dan avatar)
  socket.on('joinGame', (data) => {
    // Daftarkan pemain BARU SAJA SETELAH mereka menekan tombol masuk
    players[socket.id] = { 
        x: 100, 
        y: 100, 
        id: socket.id,
        direction: 'down',
        isMoving: false,
        avatar: data.avatar,    // Menyimpan avatar ('boy' atau 'girl')
        playerName: data.name   // Menyimpan nama ketikan pemain
    };
    
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);
    console.log(`Pemain ${socket.id} resmi masuk sebagai ${data.name} (${data.avatar})`);
  });
  
  socket.on('playerMovement', (movementData) => {
    // Pastikan pemain sudah terdaftar sebelum memproses pergerakan
    if (players[socket.id]) {
        players[socket.id].x = movementData.x;
        players[socket.id].y = movementData.y;
        players[socket.id].direction = movementData.direction; 
        players[socket.id].isMoving = movementData.isMoving; 

        socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('disconnect', () => {
    console.log('Pemain terputus:', socket.id);
    if (players[socket.id]) {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
