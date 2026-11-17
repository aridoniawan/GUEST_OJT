# ============================================================
#  WifiGuest - Installer Agent Remote Hotspot (Windows 10/11)
#  Jalankan sekali di tiap PC store (otomatis minta hak admin).
#  Hotspot yang dibuat: SSID Store_Guest | Password ABAGUEST26
# ============================================================
param(
  [string]$StoreName = '',
  [string]$Server = 'https://wifi-ojt.netlify.app'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# --- Auto elevasi ke admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-Server', ('"{0}"' -f $Server))
  if ($StoreName) { $argList += @('-StoreName', ('"{0}"' -f $StoreName)) }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
  exit
}

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ' WifiGuest - Installer Agent Hotspot Store (v3)' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

if (-not $StoreName) {
  $StoreName = Read-Host 'Nama store untuk PC ini (mis. Store Jakarta 1)'
}
if (-not $StoreName.Trim()) { $StoreName = $env:COMPUTERNAME }
$StoreName = $StoreName.Trim()

$Server = $Server.TrimEnd('/')
if ($Server -eq '' -or $Server -like '*__SERVER_URL__*') {
  # Salinan installer lama tanpa URL: pakai URL default, jangan gagalkan instalasi.
  $Server = 'https://wifi-ojt.netlify.app'
  Write-Host '      Catatan: URL server otomatis diisi ke https://wifi-ojt.netlify.app' -ForegroundColor Yellow
}

$Dir = Join-Path $env:ProgramData 'WifiGuest'
New-Item -ItemType Directory -Path $Dir -Force | Out-Null

# --- Pastikan layanan Mobile Hotspot (icssvc) aktif ---
Write-Host '[1/5] Mengaktifkan layanan Windows Mobile Hotspot...' -ForegroundColor Yellow
try {
  Set-Service -Name icssvc -StartupType Automatic -ErrorAction SilentlyContinue
  Start-Service -Name icssvc -ErrorAction SilentlyContinue
} catch { }

# --- Hapus policy pemblokir (NC_ShowSharedAccessUI) bila ada ---
$polKey = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Network Connections'
try {
  $polVal = (Get-ItemProperty -Path $polKey -Name NC_ShowSharedAccessUI -ErrorAction SilentlyContinue).NC_ShowSharedAccessUI
  if ($null -ne $polVal) {
    Set-Content -Path (Join-Path $Dir 'policy-backup.txt') -Value "NC_ShowSharedAccessUI=$polVal"
    Remove-ItemProperty -Path $polKey -Name NC_ShowSharedAccessUI -ErrorAction Stop
    Restart-Service icssvc -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host '      Policy pemblokir hotspot ditemukan & dinonaktifkan (backup di policy-backup.txt).' -ForegroundColor Yellow
  }
} catch { }

# --- Matikan fitur auto-off hotspot saat tidak ada klien (tanpa ini hotspot bisa mati sendiri) ---
try {
  $nct = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::IsNoConnectionsTimeoutEnabled()
  if ($nct) {
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::DisableNoConnectionsTimeout()
    Write-Host '      Auto-off hotspot saat tanpa klien: DINONAKTIFKAN.' -ForegroundColor Yellow
  }
} catch { }
Write-Host '      Selesai.' -ForegroundColor Green

# --- Helper WinRT (tahan terhadap bug proyeksi async PS 5.1 di build Windows baru) ---
Add-Type -AssemblyName System.Runtime.WindowsRuntime
if (-not ('WifiGuest.AsyncWaiter' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace WifiGuest {
  public enum AsyncStatusRaw { Started = 0, Completed = 1, Canceled = 2, Error = 3 }

  [ComImport, Guid("00000036-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAsyncInfoRaw {
    void GetIids(out int iidCount, out IntPtr iids);
    void GetRuntimeClassName(out IntPtr className);
    void GetTrustLevel(out int trustLevel);
    uint get_Id();
    AsyncStatusRaw get_Status();
    int get_ErrorCode();
    void Cancel();
    void Close();
  }

  public static class AsyncWaiter {
    public static string Wait(object opObj, int timeoutMs) {
      try {
        var info = (IAsyncInfoRaw)opObj;
        int waited = 0;
        while (info.get_Status() == AsyncStatusRaw.Started && waited < timeoutMs) {
          System.Threading.Thread.Sleep(200);
          waited += 200;
        }
        var st = info.get_Status();
        if (st == AsyncStatusRaw.Completed) return "OK";
        if (st == AsyncStatusRaw.Error) return "ERROR;HRESULT=0x" + info.get_ErrorCode().ToString("X8");
        if (st == AsyncStatusRaw.Canceled) return "CANCELED";
        return "TIMEOUT";
      } catch (Exception ex) {
        return "WAITER_ERR:" + ex.GetType().Name + ":" + ex.Message;
      }
    }
  }
}
'@
}

function Wait-WinRTOp($op, $timeoutMs = 60000) {
  return [WifiGuest.AsyncWaiter]::Wait($op, $timeoutMs)
}

function Get-TetheringManager {
  $cp = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
  if (-not $cp) { throw 'Tidak ada koneksi internet aktif di PC ini.' }
  return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($cp)
}

function Set-HotspotState($On) {
  $tm = Get-TetheringManager
  $target = if ($On) { 'On' } else { 'Off' }
  $opResult = ''
  if ($On) {
    $op = $tm.StartTetheringAsync()
    $opResult = Wait-WinRTOp $op 90000
  } else {
    $op = $tm.StopTetheringAsync()
    $opResult = Wait-WinRTOp $op 60000
  }
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if ($tm.TetheringOperationalState.ToString() -eq $target) { return 'OK' }
    Start-Sleep -Seconds 3
  }
  return $opResult
}

# --- Buat konfigurasi hotspot & nyalakan ---
Write-Host '[2/5] Membuat konfigurasi hotspot Store_Guest...' -ForegroundColor Yellow
$hotspotState = 'UNKNOWN'
$hotspotError = ''
try {
  $tm = Get-TetheringManager
  try {
    if ($tm.TetheringOperationalState.ToString() -ne 'Off') { $null = Set-HotspotState $false }
  } catch { }
  $cfg = New-Object Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
  $cfg.Ssid = 'Store_Guest'
  $cfg.Passphrase = 'ABAGUEST26'
  $cfgRes = Wait-WinRTOp ($tm.ConfigureAccessPointAsync($cfg)) 60000
  if ($cfgRes -ne 'OK') {
    $hotspotError = "ConfigureAccessPoint: $cfgRes"
  } else {
    $check = $tm.GetCurrentAccessPointConfiguration()
    if ($check.Ssid -ne 'Store_Guest') {
      $hotspotError = 'ConfigureAccessPoint: SSID tidak tersimpan.'
    } else {
      $st = Set-HotspotState $true
      if ($st -eq 'OK') { $hotspotState = 'ON' } else { $hotspotError = "StartTethering: $st" }
    }
  }
} catch {
  $hotspotError = $_.Exception.Message
}
if ($hotspotState -ne 'ON') {
  Write-Host '      API utama gagal, coba metode cadangan (hosted network)...' -ForegroundColor DarkYellow
  try {
    $null = netsh wlan set hostednetwork mode=allow ssid=Store_Guest key=ABAGUEST26 2>&1
    $null = netsh wlan start hostednetwork 2>&1
    if ($LASTEXITCODE -eq 0) { $hotspotState = 'ON'; $hotspotError = '' } else { $hotspotError = "$hotspotError; netsh exit $LASTEXITCODE" }
  } catch {
    $hotspotError = "$hotspotError; $($_.Exception.Message)"
  }
}
if ($hotspotState -eq 'ON') {
  Write-Host '      Hotspot AKTIF: Store_Guest / ABAGUEST26' -ForegroundColor Green
} else {
  Write-Host '      PERINGATAN: hotspot belum bisa aktif.' -ForegroundColor Red
  Write-Host "      Alasan: $hotspotError" -ForegroundColor Red
  Write-Host '      Pastikan PC punya adapter WiFi yang mendukung hotspot.' -ForegroundColor DarkYellow
}

# --- ID device unik (stabil per PC) ---
$machineGuid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction SilentlyContinue).MachineGuid
if ($machineGuid) { $shortId = $machineGuid.Substring(0, 8) } else { $shortId = (Get-Random -Maximum 0xFFFFFF).ToString('X6') }
$slug = ($StoreName -replace '[^A-Za-z0-9]+', '-').Trim('-')
if (-not $slug) { $slug = $env:COMPUTERNAME }
$deviceId = "$slug-$shortId"

# --- Registrasi ke server ---
Write-Host '[3/5] Registrasi ke server...' -ForegroundColor Yellow
try {
  $body = @{ device_id = $deviceId; name = $StoreName } | ConvertTo-Json
  $reg = Invoke-RestMethod -Uri "$Server/api/register" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 30
  $token = $reg.token
} catch {
  Write-Host "      GAGAL registrasi ke $Server : $($_.Exception.Message)" -ForegroundColor Red
  Read-Host 'Tekan Enter untuk keluar'
  exit 1
}
Write-Host "      Terdaftar sebagai: $StoreName ($deviceId)" -ForegroundColor Green

$cfgObj = [ordered]@{
  server    = $Server
  device_id = $deviceId
  token     = $token
  name      = $StoreName
  interval  = 15
}
$cfgObj | ConvertTo-Json | Set-Content -Path (Join-Path $Dir 'config.json') -Encoding UTF8

# --- Download agent & pasang scheduled task ---
Write-Host '[4/5] Memasang agent & penjadwalan otomatis...' -ForegroundColor Yellow
try {
  Invoke-WebRequest -Uri "$Server/agent.ps1" -OutFile (Join-Path $Dir 'agent.ps1') -UseBasicParsing -TimeoutSec 30
} catch {
  Write-Host "      GAGAL download agent.ps1: $($_.Exception.Message)" -ForegroundColor Red
}
try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}\agent.ps1"' -f $Dir)
  $t1 = New-ScheduledTaskTrigger -AtStartup
  $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::FromDays(3650))
  $registered = $false
  try {
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName 'WifiGuestAgent' -Action $action -Trigger @($t1, $t2) -Principal $principal -Description 'WifiGuest remote hotspot agent' -Force | Out-Null
    $registered = $true
  } catch {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName 'WifiGuestAgent' -Action $action -Trigger @($t1, $t2) -Principal $principal -Description 'WifiGuest remote hotspot agent' -Force | Out-Null
    $registered = $true
  }
  Write-Host '      Scheduled task "WifiGuestAgent" terpasang (jalan saat boot + tiap 1 menit).' -ForegroundColor Green
} catch {
  Write-Host "      GAGAL memasang scheduled task: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '      Agent tetap bisa dijalankan manual: jalankan agent.ps1.' -ForegroundColor DarkYellow
}

# --- Jalankan agent sekarang ---
Write-Host '[5/5] Menjalankan agent...' -ForegroundColor Yellow
try {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $Dir 'agent.ps1')))
  Write-Host '      Agent berjalan.' -ForegroundColor Green
} catch {
  Write-Host '      Gagal menjalankan agent saat ini, akan mulai otomatis pada jadwal berikutnya.' -ForegroundColor DarkYellow
}

# --- Laporkan status awal ke server ---
if ($hotspotState -eq 'ON' -or $hotspotState -eq 'OFF') {
  try {
    $rep = @{ device_id = $deviceId; token = $token; hotspot = $hotspotState; error = $hotspotError } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$Server/api/status" -Method Post -ContentType 'application/json' -Body $rep -UseBasicParsing -TimeoutSec 20
  } catch { }
}

Write-Host ''
Write-Host '==========================================' -ForegroundColor Green
Write-Host '  PEMASANGAN SELESAI' -ForegroundColor Green
Write-Host '==========================================' -ForegroundColor Green
Write-Host "  Server  : $Server" -ForegroundColor White
Write-Host "  Store   : $StoreName ($deviceId)" -ForegroundColor White
Write-Host "  SSID    : Store_Guest" -ForegroundColor White
Write-Host "  Password: ABAGUEST26" -ForegroundColor White
Write-Host "  Status  : $hotspotState" -ForegroundColor White
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'
