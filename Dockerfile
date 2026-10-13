# Image berbasis Debian (glibc), bukan Alpine (musl).
# better-sqlite3 adalah native module; prebuild resminya dibuat untuk glibc,
# sehingga Alpine/musl kerap menyebabkan "Segmentation fault" saat start.
# Node 20 LTS dipilih agar prebuild / kompilasi native stabil.
FROM node:20-slim

# Alat build untuk mengompilasi better-sqlite3 dari source bila prebuild
# tidak tersedia untuk arsitektur runtime. python3 + make + g++ wajib ada
# untuk node-gyp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependency dulu (lapisan cache terpisah dari kode).
# Sertakan devDependencies tidak perlu; aplikasi ini tak punya langkah build.
COPY package.json package-lock.json ./

# Build better-sqlite3 dari source di dalam container agar native binary
# cocok dengan OS + arsitektur + versi Node runtime ini (hilangkan segfault
# akibat binary lintas-platform). --omit=dev: hanya dependency produksi.
RUN npm ci --omit=dev --build-from-source

# Salin sisa kode aplikasi.
COPY . .

ENV NODE_ENV=production
# PORT disuntikkan Railway; server mendengarkan 0.0.0.0 saat PORT ada.
EXPOSE 3000

CMD ["node", "src/server.js"]
