const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Konfigurasi Socket.io agar menerima koneksi dari mandatbumi.id
const io = new Server(server, {
  cors: {
    origin: "*", // Ganti dengan "https://mandatbumi.id" saat produksi
    methods: ["GET", "POST"]
  }
});

const players = {}; // Menyimpan data posisi 5 pemain

io.on('connection', (socket) => {
    // ... log connection ...

    // Update data default pemain: tambahkan arah (direction)
    players[socket.id] = { 
        x: 100, 
        y: 100, 
        id: socket.id, 
        direction: 'down', // Default hadap bawah
        isMoving: false // Default diam
    };
  
  // Kirim semua posisi pemain saat ini ke pemain yang baru masuk
  socket.emit('currentPlayers', players);
  // Beritahu pemain lain ada pemain baru
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // Menerima update pergerakan dari frontend
  socket.on('playerMovement', (movementData) => {
    players[socket.id].x = movementData.x;
    players[socket.id].y = movementData.y;
    // Siarkan posisi baru ke semua pemain lain
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
