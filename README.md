# WifiGuest — Remote Kontrol Hotspot Windows (Tanpa VPN)

Sistem untuk menyalakan/mematikan hotspot Windows 10/11 di banyak PC store dari jarak jauh
melalui website, tanpa VPN dan tanpa port forwarding.

- Hotspot otomatis dibuat oleh installer: **SSID `Store_Guest` / Password `ABAGUEST26`**
- Login admin dashboard: **user `admin` / password `locABA10`**
- PC store hanya butuh koneksi internet — agent melakukan polling keluar (outbound HTTPS) tiap 15 detik

## Arsitektur

```
Admin (browser) ⇄ Website + API (Netlify Functions) ⇄ Netlify Blobs (database)
                                                        ↑
                              PC store (agent PowerShell) — polling keluar tiap 15 dtk
```

| Komponen | Isi |
| --- | --- |
| `public/` | Dashboard (login, daftar store, halaman download) + `agent.ps1` + `install.bat` |
| `netlify/functions/` | API: `login`, `register`, `poll`, `report`, `command`, `devices`, `script` |
| `scripts/install-agent.ps1` | Installer client (default server `https://wifi-ojt.netlify.app`, URL di-inject otomatis saat download dari website) |
| `scripts/` | Dev server lokal, test API, generator template |

Alur perintah: admin klik ON/OFF → perintah disimpan di Blobs → PC store ambil saat polling →
eksekusi hotspot via WinRT (`NetworkOperatorTetheringManager`, fallback `netsh wlan hostednetwork`) →
status dikirim balik ke dashboard.

## Deploy ke Netlify

> Fungsi serverless TIDAK bisa di-deploy lewat drag-and-drop. Pakai salah satu cara di bawah.

**Cara 1 — Netlify CLI:**
```bash
npm install
npx netlify login
npx netlify deploy --prod
```
Pilih "Create & configure a new site" lalu set publish directory ke `public`.

**Cara 2 — Git:**
push folder ini ke GitHub/GitLab, lalu di dashboard Netlify: *Add new site → Import an existing project*.
Build command `node scripts/build-template.mjs` dan publish directory `public` sudah terisi otomatis dari `netlify.toml`.

**Variabel lingkungan (opsional):**

| Nama | Keterangan |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | Hash SHA-256 password admin (default: hash `locABA10`) |
| `ADMIN_USER` | Username admin (default: `admin`) |
| `SESSION_SECRET` | Secret untuk token session admin (wajib diganti di produksi) |

## Pasang di PC store

1. Buka website → halaman **Download Script** → download `install-agent.ps1` + `install.bat` (URL server sudah otomatis tertanam).
2. Kirim kedua file ke PC store, taruh di folder yang sama.
3. Double-klik `install.bat` → izinkan UAC → isi nama store.
4. Selesai: hotspot langsung aktif, PC terdaftar di dashboard, agent jalan otomatis saat boot (Scheduled Task `WifiGuestAgent`).

Syarat PC store: Windows 10/11, WiFi adapter yang mendukung mobile hotspot, layanan
`icssvc` (otomatis diaktifkan installer), dan PC tetap login ke Windows.

## Catatan

- **Batas free tier Netlify:** 125.000 function invocations/bulan. Satu PC polling 15 detik ≈ 172.000
  panggilan/bulan — untuk >1 PC pakai paket berbayar, atau naikkan `interval` di
  `C:\ProgramData\WifiGuest\config.json` (mis. 30 detik ≈ 86.000/bulan/PC).
- Register device terbuka (tidak butuh login) — cukup aman untuk MVP; tambahkan kode registrasi
  di `register.mjs` jika perlu.
- Ganti password admin default via env `ADMIN_PASSWORD_HASH` setelah deploy.

## Jalankan lokal

```bash
npm install
npm run build   # generate template installer
npm run dev     # http://localhost:8787 (data tersimpan di .data/ untuk dev)
npm test        # test API lengkap
```
