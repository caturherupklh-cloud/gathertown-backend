const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
// PUSTAKA LIVEKIT
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// KUNCI RAHASIA LIVEKIT (Hanya Server yang Tahu)
const LIVEKIT_API_KEY = "APIDdNDQy6Txpnj";
const LIVEKIT_API_SECRET = "HAyKkmCV3bXdwUu1fs1T08SfzSExm8CPCFKazv18X6y";
const ROOM_NAME = "MandatBumi_Global";

const players = {}; 

io.on('connection', (socket) => {
  console.log('Koneksi baru masuk (belum login):', socket.id);

  const PIN_RAHASIA = "15072023"; 

  socket.on('joinGame', async (data) => {
      
    if (data.pin !== PIN_RAHASIA) {
        socket.emit('loginFailed', "❌ Akses Ditolak: PIN Rahasia Salah!");
        console.log(`Penyusup ditolak: ${socket.id}`);
        return; 
    }

    try {
        // --- MESIN PENCETAK TIKET LIVEKIT ---
        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          identity: socket.id,
          name: data.name,
        });
        
        at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true });
        
        const tokenLiveKit = await at.toJwt();
        // ------------------------------------

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
        
        // PENTING: Mengirim tiket kembali ke Frontend!
        socket.emit('loginSuccess', { 
            livekitToken: tokenLiveKit 
        }); 
        
        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        console.log(`Pemain ${socket.id} resmi masuk. Tiket LiveKit berhasil dicetak!`);
        
    } catch (error) {
        console.error("Gagal mencetak tiket:", error);
        socket.emit('loginFailed', "❌ Error: Peladen gagal mencetak tiket video.");
    }
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
    if (players[socket.id]) {
        const senderName = players[socket.id].playerName;
        
        // ==========================================
        // KODE RAHASIA ADMIN: FITUR KICK PLAYER
        // ==========================================
        if (text.startsWith('/kick ')) {
            // Mengambil nama target setelah ketikan "/kick "
            const targetName = text.replace('/kick ', '').trim().toLowerCase();
            
            let targetSocketId = null;
            // Cari ID pemain yang namanya cocok dengan target
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id;
                    break;
                }
            }

            if (targetSocketId) {
                // 1. Kirim "Surat Kiamat" ke komputer target
                io.to(targetSocketId).emit('kickedOut');
                
                // 2. Putus paksa koneksinya dari server Socket.io
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) targetSocket.disconnect(true);
                
                // 3. Beri laporan rahasia ke Admin (Kamu)
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil menendang ${targetName} dari ruangan!` });
            } else {
                // Laporan jika nama salah/typo
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return; // Hentikan fungsi di sini, jangan bocorkan teks /kick ini ke chat publik!
        }

      // ==========================================
        // KODE RAHASIA ADMIN: FITUR STOP SHARE SCREEN
        // ==========================================
        if (text.startsWith('/stopscreen ')) {
            const targetName = text.replace('/stopscreen ', '').trim().toLowerCase();
            
            let targetSocketId = null;
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id;
                    break;
                }
            }

            if (targetSocketId) {
                // Tembakkan sinyal pemutus layar ke komputer target
                io.to(targetSocketId).emit('forceStopScreen');
                
                // Laporan ke Admin
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil menghentikan Share Screen ${targetName}!` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Gagal! Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return; // Hentikan fungsi di sini
        }

      // ==========================================
        // KODE RAHASIA ADMIN: FITUR MUTE MIC
        // ==========================================
        if (text.startsWith('/mute ')) {
            const targetName = text.replace('/mute ', '').trim().toLowerCase();
            let targetSocketId = null;
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id; break;
                }
            }
            if (targetSocketId) {
                io.to(targetSocketId).emit('forceMute');
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil mematikan Mic ${targetName}!` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return; // Hentikan fungsi di sini
        }

        // ==========================================
        // KODE RAHASIA ADMIN: FITUR MATIKAN KAMERA
        // ==========================================
        if (text.startsWith('/camoff ')) {
            const targetName = text.replace('/camoff ', '').trim().toLowerCase();
            let targetSocketId = null;
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id; break;
                }
            }
            if (targetSocketId) {
                io.to(targetSocketId).emit('forceCamOff');
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil mematikan Kamera ${targetName}!` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return; // Hentikan fungsi di sini
        }

// ==========================================
        // KODE RAHASIA ADMIN: MINTA NYALAKAN MIC
        // ==========================================
        if (text.startsWith('/askmic ')) {
            const targetName = text.replace('/askmic ', '').trim().toLowerCase();
            let targetSocketId = null;
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id; break;
                }
            }
            if (targetSocketId) {
                io.to(targetSocketId).emit('requestMic');
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Permintaan menyalakan Mic telah dikirim ke layar ${targetName}!` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return;
        }

        // ==========================================
        // KODE RAHASIA ADMIN: MINTA NYALAKAN KAMERA
        // ==========================================
        if (text.startsWith('/askcam ')) {
            const targetName = text.replace('/askcam ', '').trim().toLowerCase();
            let targetSocketId = null;
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id; break;
                }
            }
            if (targetSocketId) {
                io.to(targetSocketId).emit('requestCam');
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Permintaan menyalakan Kamera telah dikirim ke layar ${targetName}!` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return;
        }
      
        // ==========================================
        // JIKA BUKAN PERINTAH ADMIN, KIRIM SEBAGAI CHAT BIASA
        // ==========================================
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

}); // <-- Kurung penutup utama yang sebelumnya hilang atau bergeser

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
