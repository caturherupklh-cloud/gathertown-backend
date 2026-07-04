# Gunakan sistem operasi Linux ringan dengan Node.js bawaan
FROM node:18-alpine

# Buat folder kerja di dalam peladen
WORKDIR /app

# Salin daftar pustaka yang dibutuhkan
COPY package*.json ./

# Instal semua pustaka (Socket.io, Express, LiveKit SDK)
RUN npm install

# Salin sisa kode server.js
COPY . .

# Buka gerbang port 3000
EXPOSE 3000

# Jalankan server
CMD ["node", "server.js"]
