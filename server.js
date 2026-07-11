require('dotenv').config(); 

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const VIP_PASSWORD = process.env.ROOM_PASSWORD;

// 👇 TAMBAHKAN BARIS INI KEMBALI
const ROOM_NAME = "MandatBumi_Global"; 

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

const players = {};
const rateLimits = {};
let mainAdminId = null; // Menyimpan ID Admin Utama
let coHostIds = [];     // Array untuk menampung banyak Co-Host (Admin Pembantu)
let pendingUsers = {};

// ==========================================
// MESIN PASSWORD DINAMIS KASTA 2
// ==========================================
// Fungsi pembuat 4 digit angka acak (0000 - 9999)
const generatePIN = () => Math.floor(1000 + Math.random() * 9000).toString(); 

// Brankas penyimpan password untuk 4 ruang meeting
let dynamicPasswords = {
    Meeting1: generatePIN(),
    Meeting2: generatePIN(),
    Meeting3: generatePIN(),
    Meeting4: generatePIN()
};

io.on('connection', (socket) => {
    console.log('Koneksi baru masuk (belum login):', socket.id);
    rateLimits[socket.id] = { lastMove: 0, lastChat: 0 };

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

      // ==========================================
      // FITUR BARU: PEMBATAS KAPASITAS MAKSIMAL (25 USER)
      // ==========================================
      const MAKSIMAL_USER = 25;
      if (Object.keys(players).length >= MAKSIMAL_USER) {
      socket.emit('loginFailed', `❌ Ruangan penuh! Kapasitas maksimal (${MAKSIMAL_USER} user) telah tercapai.`);
      return; // Hentikan proses login agar tidak masuk ke ruang tunggu atau lobby
      }


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
            // Tentukan dimensi awal semua pemain baru
            const targetRoom = "Lobby"; 
            
            // A. Cetak Tiket LiveKit DULU (Hanya untuk ruang Lobby)
            const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
              identity: targetSocketId,
              name: data.name,
            });
            // Ganti ROOM_NAME menjadi targetRoom yang dinamis
            at.addGrant({ roomJoin: true, room: targetRoom, canPublish: true, canSubscribe: true });
            const tokenLiveKit = await at.toJwt();

            // B. Simpan Data Pemain
            const randomSpawnX = Math.floor(Math.random() * (1344 - 1056 + 1)) + 1056;
            const randomSpawnY = Math.floor(Math.random() * (352 - 160 + 1)) + 160;
            
            players[targetSocketId] = {
                id: targetSocketId,
                room: targetRoom, // <--- JANGKAR DIMENSI KASTA 2
                x: randomSpawnX, 
                y: randomSpawnY,
                direction: 'down',
                isMoving: false,
                isBroadcasting: false,
                avatar: data.avatar,
                playerName: data.name,
                inCall: false, callTarget: null,
                vx: 0, 
                vy: 0
            };

            // C. Masukkan Soket Jaringan ke Ruang Isolasi
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.join(targetRoom);
            }

            // D. Buat fungsi kecil untuk mengambil pemain khusus di Lobby saja
            const playersInLobby = {};
            for (let id in players) {
                if (players[id].room === targetRoom) {
                    playersInLobby[id] = players[id];
                }
            }

            // E. Kirim Sukses beserta Tiket LiveKit!
            io.to(targetSocketId).emit('loginSuccess', { 
                id: targetSocketId, 
                players: playersInLobby, // Hanya kirim data orang-orang di Lobby
                livekitToken: tokenLiveKit
            });
            
            // F. Umumkan HANYA ke ruangan targetRoom (Lobby)
            io.to(targetRoom).emit('playerJoined', players[targetSocketId]);
            io.to(targetRoom).emit('currentPlayers', playersInLobby);
            
            if (targetSocket) {
                targetSocket.broadcast.to(targetRoom).emit('newPlayer', players[targetSocketId]);
            }
            
            console.log(`Pemain ${targetSocketId} berhasil masuk ke ${targetRoom}.`);
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

    // ==========================================
    // SISTEM PORTAL KASTA 2: PINDAH RUANGAN
    // ==========================================
    socket.on('mintaPindahRuangan', async (req) => {
        const p = players[socket.id];
        if (!p) return;

        const { targetRoom, password } = req;
        const oldRoom = p.room;

        // Validasi Pintu VIP
        if (targetRoom !== 'Lobby') {
            // Cek apakah targetRoom ada di dalam brankas dynamicPasswords kita
            const sandiAsli = dynamicPasswords[targetRoom];
            
            if (sandiAsli && password !== sandiAsli) {
                socket.emit('pindahRuanganGagal', `❌ Akses Ditolak: PIN untuk ${targetRoom} salah.`);
                return;
            }
        }

        try {
            // 1. Cetak Tiket Media Baru khusus untuk ruangan tujuan
            const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
                identity: socket.id,
                name: p.playerName,
            });
            at.addGrant({ roomJoin: true, room: targetRoom, canPublish: true, canSubscribe: true });
            const newToken = await at.toJwt();

            // 2. Cabut dari Dimensi Lama
            socket.leave(oldRoom);
            io.to(oldRoom).emit('playerDisconnected', socket.id);

            // 3. Pindah Fisik ke Dimensi Baru
            socket.join(targetRoom);
            p.room = targetRoom;
            
            // 4. Letakkan di titik spawn secara ACAK (Mencegah avatar bertumpuk & nyangkut)
            let minX, maxX, minY, maxY;

            if (targetRoom === 'Meeting1') {
                minX = 320; maxX = 480; 
                minY = 448; maxY = 512; 
            } else if (targetRoom === 'Meeting2') {
                minX = 320; maxX = 480; 
                minY = 448; maxY = 512;  
            } else if (targetRoom === 'Meeting3') {
                minX = 320; maxX = 480; 
                minY = 448; maxY = 512;  
            } else if (targetRoom === 'Meeting4') {
                minX = 320; maxX = 480; 
                minY = 448; maxY = 512; 
            } else {
                // Koordinat mendarat saat kembali ke Lobby
                minX = 1056; maxX = 1344; 
                minY = 160; maxY = 352; 
            }

            // Terapkan rumus acak matematika berdasarkan area yang dipilih di atas
            p.x = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
            p.y = Math.floor(Math.random() * (maxY - minY + 1)) + minY;

            // 5. Kumpulkan data pemain yang ada di ruang baru
            const playersInNewRoom = {};
            for (let id in players) {
                if (players[id].room === targetRoom) {
                    playersInNewRoom[id] = players[id];
                }
            }

            // 6. Kirim Data Baru ke Pemohon
            socket.emit('pindahRuanganSukses', {
                room: targetRoom,
                players: playersInNewRoom,
                livekitToken: newToken,
                newX: p.x,
                newY: p.y
            });

            // 7. Umumkan Kehadiran kepada orang-orang di dimensi baru
            socket.broadcast.to(targetRoom).emit('newPlayer', p);
            console.log(`${p.playerName} berpindah ke ruang ${targetRoom}`);

        } catch (error) {
            console.error("Gagal memindahkan ruangan:", error);
            socket.emit('pindahRuanganGagal', '❌ Error sistem saat menghubungi LiveKit.');
        }
    });
  
  socket.on('playerMovement', (pack) => {
        // ANTI-SPAM GERAKAN: Cek jarak waktu dari paket sebelumnya
        const now = Date.now();
        if (rateLimits[socket.id] && now - rateLimits[socket.id].lastMove < 30) {
            return; // 🛑 Tolak paket jika terlalu cepat (< 30ms)
        }
        if (rateLimits[socket.id]) rateLimits[socket.id].lastMove = now;
        // Pastikan data yang masuk adalah Array hasil packing kita
        if (players[socket.id] && Array.isArray(pack)) {
            const dirMap = { 'u': 'up', 'd': 'down', 'l': 'left', 'r': 'right' };
            const myRoom = players[socket.id].room; // <--- Cek orang ini ada di ruang mana
            
            // Kupas data Array ke dalam variabel memori server
            players[socket.id].x = pack[0];
            players[socket.id].y = pack[1];
            players[socket.id].direction = dirMap[pack[2]]; 
            players[socket.id].isMoving = pack[3] === 1;
            players[socket.id].isBroadcasting = pack[4] === 1;
            players[socket.id].vx = pack[5];
            players[socket.id].vy = pack[6];

            // --- SISTEM AREA OF INTEREST (AOI) TERISOLASI ---
            for (let targetId in players) {
                if (targetId !== socket.id) {
                    let targetPlayer = players[targetId];
                    
                    // KUNCI KASTA 2: Hanya hitung jarak & kirim data jika di ruangan yang sama
                    if (targetPlayer.room === myRoom) {
                        let jarakX = Math.abs(players[socket.id].x - targetPlayer.x);
                        let jarakY = Math.abs(players[socket.id].y - targetPlayer.y);

                        if (players[socket.id].isBroadcasting || (jarakX < 450 && jarakY < 360)) {
                            io.to(targetId).emit('playerMoved', [socket.id, ...pack]);
                        }
                    }
                }
            }
        }
    });

 socket.on('sendMessage', (data) => {
    // Ekstrak data baru, dengan fallback agar kode lama tetap aman
    const text = typeof data === 'object' ? data.text : data;
    const targetId = typeof data === 'object' ? data.targetId : 'all';

    const now = Date.now();
        if (rateLimits[socket.id] && now - rateLimits[socket.id].lastChat < 1000) {
            socket.emit('receiveMessage', { name: "🤖 System", text: "⚠️ Anti-Spam: Tunggu 1 detik sebelum mengirim pesan lagi!" });
            return; // 🛑 Tolak pesan
        }
    if (rateLimits[socket.id]) rateLimits[socket.id].lastChat = now;
    if (players[socket.id]) {
        const senderName = players[socket.id].playerName;
       // ==========================================
        // SATPAM HIRARKI: CEK STATUS ADMIN
        // ==========================================
        const isMainAdmin = (socket.id === mainAdminId);
        const isCoHost = coHostIds.includes(socket.id);
        const isAnyAdmin = isMainAdmin || isCoHost;

        // Daftar semua perintah rahasia admin
        const isAdminCommand = text.startsWith('/kick ') || text.startsWith('/stopscreen ') || text.startsWith('/mute ') || text.startsWith('/camoff ') || text.startsWith('/askmic ') || text.startsWith('/askcam ') || text.startsWith('/call ') || text.trim() === '/endcall' ||text.trim() === '/showpass' || text.trim() === '/resetpass' || text.trim() === '/minimap' || text.startsWith('/jadicohost ') || text.startsWith('/lepascohost ');

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
        // ==========================================
        // KLAIM ADMIN UTAMA DENGAN PASSWORD
        // ==========================================
        if (text.startsWith('/bismillah ')) {
            const passwordInput = text.replace('/bismillah ', '').trim();

            if (passwordInput === VIP_PASSWORD) { // <-- GitHub hanya nampilin teks VIP_PASSWORD
                if (!mainAdminId) {
                    mainAdminId = socket.id;
                    socket.emit('receiveMessage', { name: "🤖 System", text: `👑 Selamat! Anda sekarang adalah ADMIN UTAMA. Pintu masuk telah dikunci secara otomatis.` });
                    io.emit('receiveMessage', { name: "🤖 System", text: `👑 ${players[socket.id].playerName} telah mengklaim posisi sebagai Admin Utama ruangan ini!` });
                } else if (isMainAdmin) {
                    socket.emit('receiveMessage', { name: "🤖 System", text: `⚠️ Anda sudah menjadi Admin Utama.` });
                } else {
                    socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Gagal! Sudah ada Admin Utama di ruangan ini.` });
                }
            } else {
                // Jika password salah
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Akses Ditolak! Password Admin salah.` });
            }
            return;
        }

      // ==========================================
        // KODE RAHASIA ADMIN: LIHAT PASSWORD RUANGAN
        // ==========================================
        if (text.trim() === '/showpass') {
            if (!isMainAdmin) {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Ditolak! Hanya Admin Utama yang boleh melihat kunci.` });
                return;
            }
            
            let msg = "🔑 <b>PIN Ruang Meeting Saat Ini:</b><br>";
            for (let ruang in dynamicPasswords) {
                msg += `> ${ruang} : <b>${dynamicPasswords[ruang]}</b><br>`;
            }
            socket.emit('receiveMessage', { name: "🤖 System", text: msg });
            return;
        }

        // ==========================================
        // KODE RAHASIA ADMIN: ACAK ULANG (RESET) PASSWORD
        // ==========================================
        if (text.trim() === '/resetpass') {
            if (!isMainAdmin) {
                socket.emit('receiveMessage', { name: "🤖 System", text: `❌ Ditolak! Hanya Admin Utama yang boleh mereset kunci.` });
                return;
            }
            
            for (let ruang in dynamicPasswords) {
                dynamicPasswords[ruang] = generatePIN(); // Acak ulang
            }
            socket.emit('receiveMessage', { name: "🤖 System", text: `✅ Berhasil! Semua PIN Ruang Meeting telah diacak ulang. Ketik /showpass untuk melihat PIN baru.` });
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
        // JIKA BUKAN PERINTAH ADMIN, KIRIM SEBAGAI CHAT BIASA ATAU PRIVAT
        // ==========================================
        const myRoom = players[socket.id].room; // Cari tahu pengirim ada di mana

        // Jangan kirim chat biasa jika teksnya adalah perintah sistem rahasia admin
        if (!isAdminCommand && !text.startsWith('/bismillah') && text.trim() !== '/lepasadmin') {
            
            // --- FITUR BARU: LOGIKA PRIVATE CHAT ---
            if (targetId && targetId !== 'all') {
                // Pastikan user tujuan belum keluar (disconnect)
                if (players[targetId]) {
                    const targetName = players[targetId].playerName; // Ambil nama teman
                    const payloadPrivat = {
                        name: senderName,
                        text: text,
                        isPrivate: true,
                        toName: targetName
                    };
                    
                    // 1. Kirim diam-diam hanya ke target
                    io.to(targetId).emit('receiveMessage', payloadPrivat);
                    
                    // 2. Pantulkan kembali ke pengirim agar muncul di layar sendiri
                    socket.emit('receiveMessage', payloadPrivat);
                } else {
                    // Jika teman sudah keburu keluar/refresh halaman
                    socket.emit('receiveMessage', { name: "🤖 System", text: "⚠️ Pesan gagal dikirim, user tidak ditemukan." });
                }
            } else {
                // --- CHAT NORMAL (PUBLIC KE SEMUA ORANG DI ROOM) ---
                io.to(myRoom).emit('receiveMessage', { 
                    name: senderName, 
                    text: text 
                });
            }
        }
    } // Penutup if(players[socket.id]) dari sendMessage
}); // Penutup socket.on('sendMessage')

  socket.on('sendEmote', (emoji) => {
    if (players[socket.id]) {
        const myRoom = players[socket.id].room;
        // Kirim emote HANYA ke pemain di ruangan yang sama
        socket.broadcast.to(myRoom).emit('receiveEmote', { 
            playerId: socket.id, 
            emoji: emoji 
        });
    }
  });

  socket.on('disconnect', () => {
    console.log('Pemain terputus:', socket.id);
    if (rateLimits[socket.id]) delete rateLimits[socket.id];
    
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
        const oldRoom = players[socket.id].room; // Catat ruang terakhirnya
        delete players[socket.id];
        // Umumkan putusnya koneksi HANYA ke ruangan tersebut
        io.to(oldRoom).emit('playerDisconnected', socket.id);
    }
  });

}); // <-- Kurung penutup utama yang sebelumnya hilang atau bergeser

// ==========================================
// SISTEM RADAR GLOBAL TERISOLASI (HEARTBEAT)
// ==========================================
setInterval(() => {
    // 1. Kumpulkan daftar ruangan yang sedang aktif (ada orangnya)
    const activeRooms = [...new Set(Object.values(players).map(p => p.room))];
    
    // 2. Kirim sinkronisasi radar khusus per ruangan
    activeRooms.forEach(room => {
        const roomPlayers = {};
        for (let id in players) {
            if (players[id].room === room) {
                roomPlayers[id] = players[id];
            }
        }
        
        if (Object.keys(roomPlayers).length > 0) {
            io.to(room).emit('globalSync', roomPlayers);
        }
    });
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
