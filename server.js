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
let currentAdminId = null; 
let pendingUsers = {};

io.on('connection', (socket) => {
    console.log('Koneksi baru masuk (belum login):', socket.id);

    socket.on('joinGame', (data) => {
        // 1. Cek apakah pintu sedang dikunci oleh Admin
        if (currentAdminId && currentAdminId !== socket.id) {
            pendingUsers[socket.id] = data; 
            socket.emit('loginPending'); 
            io.to(currentAdminId).emit('joinRequest', { 
                id: socket.id, 
                name: data.name, 
                avatar: data.avatar 
            });
        } else {
            // 2. Pintu terbuka bebas, langsung izinkan masuk
            prosesMasukLolos(socket.id, data);
        }
    });

    // UBAH JADI ASYNC: Fungsi pemroses pemain yang berhasil lolos
    async function prosesMasukLolos(targetSocketId, data) {
        try {
            // A. Cetak Tiket LiveKit DULU
            const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
              identity: targetSocketId,
              name: data.name,
            });
            at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true });
            const tokenLiveKit = await at.toJwt();

            // B. Simpan Data Pemain
            const randomSpawnX = Math.floor(Math.random() * (1344 - 1056 + 1)) + 1056;
            const randomSpawnY = Math.floor(Math.random() * (352 - 160 + 1)) + 160;
            players[targetSocketId] = {
                x: randomSpawnX, 
                y: randomSpawnY,
                id: targetSocketId,
                direction: 'down',
                isMoving: false,
                isBroadcasting: false,
                avatar: data.avatar,
                playerName: data.name,
                inCall: false, callTarget: null
            };

            // C. Kirim Sukses beserta Tiket LiveKit!
            io.to(targetSocketId).emit('loginSuccess', { 
                id: targetSocketId, 
                players: players,
                livekitToken: tokenLiveKit
            });
            
            io.emit('playerJoined', players[targetSocketId]);
            io.emit('currentPlayers', players);
            socket.broadcast.emit('newPlayer', players[targetSocketId]);
            console.log(`Pemain ${targetSocketId} berhasil lolos. Tiket LiveKit diberikan.`);
        } catch (error) {
            console.error("Gagal mencetak tiket:", error);
            io.to(targetSocketId).emit('loginFailed', "❌ Error: Peladen gagal mencetak tiket video.");
        }
    }

    // 3. Tangkap Keputusan Admin
    socket.on('adminResponse', (res) => {
        if (socket.id !== currentAdminId) return; 
        
        let targetData = pendingUsers[res.targetId];
        if (!targetData) return;

        if (res.action === 'approve') {
            prosesMasukLolos(res.targetId, targetData);
        } else {
            io.to(res.targetId).emit('loginRejected', { message: '❌ Maaf, Admin menolak permintaan masuk Anda.' });
        }
        delete pendingUsers[res.targetId]; 
    });
  
  socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].direction = movementData.direction; 
            players[socket.id].isMoving = movementData.isMoving;
            players[socket.id].isBroadcasting = movementData.isBroadcasting;
            players[socket.id].vx = movementData.vx;
            players[socket.id].vy = movementData.vy;

            // --- SISTEM AREA OF INTEREST (AOI) ---
            // Layar berukuran 800x640. Kita gunakan jarak 1000x800 sebagai batas pandang.
            for (let targetId in players) {
                if (targetId !== socket.id) {
                    let targetPlayer = players[targetId];
                    let jarakX = Math.abs(players[socket.id].x - targetPlayer.x);
                    let jarakY = Math.abs(players[socket.id].y - targetPlayer.y);

                    // --- SISTEM AREA OF INTEREST (AOI) - ULTRA HEMAT ---
                    // Jarak layar asli ke tepi: X = 400, Y = 320. 
                    // Buffer agresif +50px dan +40px untuk efisiensi maksimal.
                    if (jarakX < 450 && jarakY < 360) {
                        io.to(targetId).emit('playerMoved', players[socket.id]);
                    }
                }
            }
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
        // KODE RAHASIA ADMIN: SUPER CALL
        // ==========================================
        if (text.startsWith('/call ')) {
            const targetName = text.replace('/call ', '').trim().toLowerCase();
            let targetSocketId = null;
            
            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id; break;
                }
            }
            
            if (targetSocketId) {
                // Kunci mereka berdua ke dalam mode panggilan
                players[socket.id].inCall = true;
                players[socket.id].callTarget = targetSocketId;
                players[targetSocketId].inCall = true;
                players[targetSocketId].callTarget = socket.id;
                
                // Siarkan status ke seluruh peta agar orang lain berhenti mendengarkan mereka
                io.emit('playerMoved', players[socket.id]);
                io.emit('playerMoved', players[targetSocketId]);

                // Kirim sinyal ke client masing-masing untuk membuka jalur WebRTC khusus
                socket.emit('callStarted', { targetId: targetSocketId, targetName: players[targetSocketId].playerName, isAdmin: true });
                io.to(targetSocketId).emit('callStarted', { targetId: socket.id, targetName: senderName, isAdmin: false });
                
                socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Saluran komunikasi rahasia terhubung dengan ${targetName}!` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain "${targetName}" tidak ditemukan.` });
            }
            return;
        }

        // CUKUP KETIK /endcall TANPA NAMA
        if (text.trim() === '/endcall') {
            const targetSocketId = players[socket.id].callTarget;
            
            // 1. Bebaskan status Admin
            players[socket.id].inCall = false;
            players[socket.id].callTarget = null;
            io.emit('playerMoved', players[socket.id]);
            socket.emit('callEnded');
            socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Panggilan rahasia dihentikan.` });

            // 2. Bebaskan status Target
            if (targetSocketId && players[targetSocketId]) {
                players[targetSocketId].inCall = false;
                players[targetSocketId].callTarget = null;
                io.emit('playerMoved', players[targetSocketId]);
                io.to(targetSocketId).emit('callEnded');
            }
            return;
        }

        // ==========================================
        // KODE RAHASIA ADMIN: TOGGLE MINIMAP
        // ==========================================
        if (text.trim() === '/minimap') {
            socket.emit('toggleMinimap');
            socket.emit('receiveMessage', { name: "🤖 System", text: `🗺️ Radar Minimap Admin diaktifkan/dimatikan.` });
            return;
        }

      // ==========================================
        // KODE RAHASIA: KLAIM SUPER ADMIN
        // ==========================================
        if (text.trim() === '/bismillah') {
            if (!currentAdminId) {
                currentAdminId = socket.id;
                socket.emit('receiveMessage', { name: "🤖 System", text: `👑 Anda sekarang adalah SUPER ADMIN! Pintu masuk telah dikunci. Anda yang menentukan siapa yang boleh masuk.` });
                io.emit('receiveMessage', { name: "🤖 System", text: `👑 ${players[socket.id].playerName} telah menjadi Super Admin ruangan ini!` });
            } else if (currentAdminId === socket.id) {
                socket.emit('receiveMessage', { name: "🤖 System", text: `⚠️ Anda sudah menjadi admin.` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Sudah ada Admin lain di ruangan ini.` });
            }
            return;
        }

        if (text.trim() === '/lepasadmin') {
            if (currentAdminId === socket.id) {
                currentAdminId = null;
                io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Admin telah melepas jabatannya. Pintu masuk kembali terbuka bebas untuk umum.` });
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
    if (currentAdminId === socket.id) {
            currentAdminId = null;
            io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Admin terputus dari server. Pintu masuk kembali terbuka bebas.` });
        }
    if (players[socket.id]) {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    }
  });

}); // <-- Kurung penutup utama yang sebelumnya hilang atau bergeser

// ==========================================
// SISTEM RADAR GLOBAL (HEARTBEAT)
// ==========================================
// Mengirim update posisi semua orang setiap 3 detik 
// agar fitur Minimap Admin tetap bekerja dan pemain yang jauh tidak "nyangkut"
setInterval(() => {
    if (Object.keys(players).length > 0) {
        io.emit('globalSync', players);
    }
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
