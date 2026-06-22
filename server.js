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
    // Bebas ganti PIN ini sesuai keinginanmu!
  const PIN_RAHASIA = "15072023"; 

  // Server menunggu event 'joinGame' dari frontend
  socket.on('joinGame', (data) => {
      
    // --- KODE BARU: PENJAGA GERBANG (SECURITY) ---
    if (data.pin !== PIN_RAHASIA) {
        // Jika PIN salah, tendang dan kirim pesan error!
        socket.emit('loginFailed', "❌ Akses Ditolak: PIN Rahasia Salah!");
        console.log(`Penyusup ditolak: ${socket.id}`);
        return; // Hentikan proses di sini
    }

    // Jika PIN benar, jalankan pendaftaran seperti biasa
    players[socket.id] = { 
        x: 100, 
        y: 100, 
        id: socket.id,
        direction: 'down',
        isMoving: false,
        isBroadcasting: false,
        avatar: data.avatar,    
        playerName: data.name   
    };
    
    // Beri tahu komputer pemain bahwa dia BERHASIL MASUK
    socket.emit('loginSuccess'); 
    
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
        players[socket.id].isBroadcasting = movementData.isBroadcasting;

        socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('sendMessage', (text) => {
    // Pastikan pengirim sudah terdaftar
    if (players[socket.id]) {
        const senderName = players[socket.id].playerName;
        
        // Siarkan pesan ke SEMUA orang (termasuk yang mengirim)
        io.emit('receiveMessage', { 
            name: senderName, 
            text: text 
        });
    }
  });

socket.on('sendEmote', (emoji) => {
    // Pastikan pengirim terdaftar
    if (players[socket.id]) {
        socket.broadcast.emit('receiveEmote', { 
            playerId: socket.id, 
            emoji: emoji 
        });
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
