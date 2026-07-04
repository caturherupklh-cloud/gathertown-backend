#!/bin/bash
echo "🚀 Memulai Sihir Deployment Mandat Bumi..."

# 1. Update sistem VPS
sudo apt-get update -y

# 2. Instal Docker & Git jika belum ada
sudo apt-get install -y docker.io docker-compose git

# 3. Kloning repositori GitHub kamu (Ganti URL dengan link repo-mu)
# Pastikan repo bersifat publik agar tidak perlu password, atau gunakan Personal Access Token
git clone https://github.com/username-kamu/mandatbumi-server.git
cd mandatbumi-server

# 4. Bangun dan nyalakan peladen di latar belakang
sudo docker-compose up -d --build

echo "✅ Selesai! Server Node.js sudah menyala di Port 3000."
