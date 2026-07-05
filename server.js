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
let mainAdminId = null; // Menyimpan ID Admin Utama
let coHostIds = [];     // Array untuk menampung banyak Co-Host (Admin Pembantu)
let pendingUsers = {};

io.on('connection', (socket) => {
    console.log('Koneksi baru masuk (belum login):', socket.id);

    socket.on('joinGame', (data) => {
        // ==========================================
        // FITUR BARU: SATPAM PENCEGAH NAMA KEMBAR
        // ==========================================
        const requestedName = data.name.trim().toLowerCase();
        let isNameTaken = false;

        // 1. Cek apakah nama sudah dipakai oleh pemain di dalam ruangan
        for (let id in players) {
            if (players[id].playerName.toLowerCase() === requestedName) {
                isNameTaken = true;
                break;
            }
        }

        // 2. Cek juga apakah nama tersebut sedang antre di Ruang Tunggu (Gatekeeper)
        if (!isNameTaken) {
            for (let id in pendingUsers) {
                if (pendingUsers[id].name.toLowerCase() === requestedName) {
                    isNameTaken = true;
                    break;
                }
            }
        }

        // Jika ketahuan kembar, tolak mentah-mentah dan hentikan proses!
        if (isNameTaken) {
            // Menggunakan event loginFailed yang sudah kita buat sebelumnya di client
            socket.emit('loginFailed', `❌ Nama "${data.name}" sudah digunakan oleh orang lain. Silakan pilih nama lain!`);
            return; 
        }
        // ==========================================


        // 1. Cek apakah pintu sedang dikunci oleh Admin
        if (mainAdminId && socket.id !== mainAdminId && !coHostIds.includes(socket.id)) {
            pendingUsers[socket.id] = data;
            socket.emit('loginPending'); 
            
            // Kirim notifikasi ke Admin Utama
            io.to(mainAdminId).emit('joinRequest', { id: socket.id, name: data.name, avatar: data.avatar });
            
            // Kirim juga ke semua Co-Host agar bisa bantu menyetujui
            coHostIds.forEach(coHostId => {
                io.to(coHostId).emit('joinRequest', { id: socket.id, name: data.name, avatar: data.avatar });
            });
        } else {
            // Pintu terbuka bebas, langsung izinkan masuk
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
                inCall: false, callTarget: null,
                vx: 0, 
                vy: 0
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
        if (socket.id !== mainAdminId && !coHostIds.includes(socket.id)) return;
        
        let targetData = pendingUsers[res.targetId];
        if (!targetData) return;

        if (res.action === 'approve') {
            prosesMasukLolos(res.targetId, targetData);
        } else {
            io.to(res.targetId).emit('loginRejected', { message: '❌ Maaf, Admin menolak permintaan masuk Anda.' });
        }
        delete pendingUsers[res.targetId]; 
    });
  
  socket.on('playerMovement', (pack) => {
        // Pastikan data yang masuk adalah Array hasil packing kita
        if (players[socket.id] && Array.isArray(pack)) {
            // Peta penerjemah 1 huruf kembali ke kata aslinya untuk memori server
            const dirMap = { 'u': 'up', 'd': 'down', 'l': 'left', 'r': 'right' };
            
            // Kupas data Array ke dalam variabel memori server
            players[socket.id].x = pack[0];
            players[socket.id].y = pack[1];
            players[socket.id].direction = dirMap[pack[2]]; 
            players[socket.id].isMoving = pack[3] === 1;
            players[socket.id].isBroadcasting = pack[4] === 1;
            players[socket.id].vx = pack[5];
            players[socket.id].vy = pack[6];

            // --- SISTEM AREA OF INTEREST (AOI) ---
            for (let targetId in players) {
                if (targetId !== socket.id) {
                    let targetPlayer = players[targetId];
                    let jarakX = Math.abs(players[socket.id].x - targetPlayer.x);
                    let jarakY = Math.abs(players[socket.id].y - targetPlayer.y);

                    if (players[socket.id].isBroadcasting || (jarakX < 450 && jarakY < 360)) {
                        // SUPER HEMAT: Selipkan 'socket.id' di urutan paling depan Array,
                        // sehingga ukurannya menjadi: [id, x, y, dir, mov, brod, vx, vy]
                        io.to(targetId).emit('playerMoved', [socket.id, ...pack]);
                    }
                }
            }
        }
    });

  socket.on('sendMessage', (text) => {
    if (players[socket.id]) {
        const senderName = players[socket.id].playerName;
       // ==========================================
        // SATPAM HIRARKI: CEK STATUS ADMIN
        // ==========================================
        const isMainAdmin = (socket.id === mainAdminId);
        const isCoHost = coHostIds.includes(socket.id);
        const isAnyAdmin = isMainAdmin || isCoHost;

        // Daftar semua perintah rahasia admin
        const isAdminCommand = text.startsWith('/kick ') || text.startsWith('/stopscreen ') || text.startsWith('/mute ') || text.startsWith('/camoff ') || text.startsWith('/askmic ') || text.startsWith('/askcam ') || text.startsWith('/call ') || text.trim() === '/endcall' || text.trim() === '/minimap' || text.startsWith('/jadicohost ') || text.startsWith('/lepascohost ');

        if (isAdminCommand && !isAnyAdmin) {
            socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Akses Ditolak! Anda bukan bagian dari Tim Admin.` });
            return; 
        }
        
        // ==========================================
// KODE RAHASIA ADMIN: FITUR KICK PLAYER
// ==========================================
if (text.startsWith('/kick ')) {
    const targetName = text.replace('/kick ', '').trim().toLowerCase();
    
    let targetSocketId = null;
    for (let id in players) {
        if (players[id].playerName.toLowerCase() === targetName) {
            targetSocketId = id;
            break;
        }
    }

    if (targetSocketId) {
        // --- SISTEM ANTI-KUDETA ---
        if (targetSocketId === mainAdminId) {
            socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Ditolak! Anda tidak bisa menendang Admin Utama.` });
            return;
        }
        
        // PERBAIKAN: Validasi hak akses Co-Host dilakukan langsung di dalam kondisi
        if (coHostIds.includes(socket.id) && coHostIds.includes(targetSocketId)) {
            socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Ditolak! Sesama Co-Host tidak diperbolehkan saling menendang.` });
            return;
        }
       
        // Eksekusi Kick
        io.to(targetSocketId).emit('kickedOut');
        
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) targetSocket.disconnect(true);
        
        socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil menendang ${targetName} dari ruangan!` });
    } else {
        socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
    }
    
    return; 
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
        // KLAIM ADMIN UTAMA
        // ==========================================
        if (text.trim() === '/bismillah') {
            if (!mainAdminId) {
                mainAdminId = socket.id;
                socket.emit('receiveMessage', { name: "🤖 System", text: `👑 Selamat! Anda sekarang adalah ADMIN UTAMA. Pintu masuk telah dikunci secara otomatis.` });
                io.emit('receiveMessage', { name: "🤖 System", text: `👑 ${players[socket.id].playerName} telah mengklaim posisi sebagai Admin Utama ruangan ini!` });
            } else if (isMainAdmin) {
                socket.emit('receiveMessage', { name: "🤖 System", text: `⚠️ Anda sudah menjadi Admin Utama.` });
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Gagal! Sudah ada Admin Utama di ruangan ini.` });
            }
            return;
        }

        // ==========================================
        // PENUNJUKAN CO-HOST (HANYA OLEH ADMIN UTAMA)
        // ==========================================
        if (text.startsWith('/jadicohost ')) {
            if (!isMainAdmin) {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Ditolak! Hanya Admin Utama yang memiliki hak prerogative menunjuk Co-Host.` });
                return;
            }

            const targetName = text.replace('/jadicohost ', '').trim().toLowerCase();
            let targetSocketId = null;

            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id;
                    break;
                }
            }

            if (targetSocketId) {
                if (targetSocketId === mainAdminId) {
                    socket.emit('receiveMessage', { name: "🤖 System", text: `⚠️ Orang tersebut adalah diri Anda sendiri (Admin Utama).` });
                } else if (coHostIds.includes(targetSocketId)) {
                    socket.emit('receiveMessage', { name: "🤖 System", text: `⚠️ ${players[targetSocketId].playerName} sudah menjadi Co-Host sebelumnya.` });
                } else {
                    coHostIds.push(targetSocketId);
                    io.to(targetSocketId).emit('receiveMessage', { name: "🤖 System", text: `👑 Anda telah diangkat menjadi Co-Host (Admin Pembantu) oleh Admin Utama!` });
                    socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil mengangkat ${players[targetSocketId].playerName} sebagai Co-Host.` });
                    io.emit('receiveMessage', { name: "🤖 System", text: `👥 PENGUMUMAN: ${players[targetSocketId].playerName} sekarang resmi menjadi Co-Host ruangan!` });
                }
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return;
        }

        // ==========================================
        // LEPAS JABATAN CO-HOST (HANYA OLEH ADMIN UTAMA)
        // ==========================================
        if (text.startsWith('/lepascohost ')) {
            // Cek perlindungan: Hanya Admin Utama yang boleh memecat
            if (!isMainAdmin) {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Ditolak! Hanya Admin Utama yang bisa mencabut jabatan Co-Host.` });
                return;
            }

            const targetName = text.replace('/lepascohost ', '').trim().toLowerCase();
            let targetSocketId = null;

            for (let id in players) {
                if (players[id].playerName.toLowerCase() === targetName) {
                    targetSocketId = id;
                    break;
                }
            }

            if (targetSocketId) {
                if (coHostIds.includes(targetSocketId)) {
                    // Hapus target dari daftar Co-Host
                    coHostIds = coHostIds.filter(id => id !== targetSocketId);
                    
                    io.to(targetSocketId).emit('receiveMessage', { name: "🤖 System", text: `⚠️ Jabatan Co-Host Anda telah dicabut oleh Admin Utama.` });
                    socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil mencabut jabatan Co-Host dari ${players[targetSocketId].playerName}.` });
                } else {
                    socket.emit('receiveMessage', { name: "🤖 System", text: `⚠️ ${players[targetSocketId].playerName} memang bukan seorang Co-Host.` });
                }
            } else {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Pemain bernama "${targetName}" tidak ditemukan.` });
            }
            return;
        }

        // ==========================================
        // LEPAS JABATAN ADMIN
        // ==========================================
        if (text.trim() === '/lepasadmin') {
            if (isMainAdmin) {
                mainAdminId = null;
                io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Admin Utama telah meletakkan jabatannya.` });
                if (coHostIds.length === 0) {
                    io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Pintu masuk kembali terbuka bebas untuk umum.` });
                }
            } else if (isCoHost) {
                coHostIds = coHostIds.filter(id => id !== socket.id);
                io.emit('receiveMessage', { name: "🤖 System", text: `🔓 ${players[socket.id].playerName} berhenti menjadi Co-Host.` });
                if (!mainAdminId && coHostIds.length === 0) {
                    io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Pintu masuk kembali terbuka bebas untuk umum.` });
                }
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
    
    // Jika Admin Utama yang DC
    if (mainAdminId === socket.id) {
        mainAdminId = null;
        io.emit('receiveMessage', { name: "🤖 System", text: `⚠️ Admin Utama terputus dari server.` });
        if (coHostIds.length === 0) {
            io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Pintu masuk kembali terbuka bebas.` });
        }
    }
    
    // Jika Co-Host yang DC
    if (coHostIds.includes(socket.id)) {
        coHostIds = coHostIds.filter(id => id !== socket.id);
        if (!mainAdminId && coHostIds.length === 0) {
            io.emit('receiveMessage', { name: "🤖 System", text: `🔓 Semua management admin terputus. Pintu kembali terbuka bebas.` });
        }
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
