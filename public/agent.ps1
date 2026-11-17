# ============================================================
#  WifiGuest - Agent Remote Hotspot (dijalankan otomatis)
#  Polling server tiap beberapa detik, eksekusi perintah ON/OFF.
# ============================================================
$ErrorActionPreference = 'Continue'
$Dir = Join-Path $env:ProgramData 'WifiGuest'
$cfgPath = Join-Path $Dir 'config.json'
if (-not (Test-Path $cfgPath)) { exit 1 }
try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json } catch { exit 1 }
if (-not $cfg.server -or -not $cfg.device_id -or -not $cfg.token) { exit 1 }

$interval = 15
try { $i = [int]$cfg.interval; if ($i -ge 3 -and $i -le 300) { $interval = $i } } catch { }

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# --- Cegah dobel instance (scheduled task tiap menit) ---
$mutex = New-Object System.Threading.Mutex($false, 'Global\WifiGuestAgent')
try {
  if (-not $mutex.WaitOne(0)) { exit 0 }
} catch { }

function Log($msg) {
  try {
    Add-Content -Path (Join-Path $Dir 'agent.log') -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
  } catch { }
}

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
  if (-not $cp) { throw 'Tidak ada koneksi internet aktif.' }
  return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($cp)
}

function Get-HotspotState {
  $tm = Get-TetheringManager
  switch ($tm.TetheringOperationalState.ToString()) {
    'On'  { return 'ON' }
    'Off' { return 'OFF' }
    default { return 'UNKNOWN' }
  }
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
  # Verifikasi lewat state aktual (hasil op saja tidak cukup di beberapa build)
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if ($tm.TetheringOperationalState.ToString() -eq $target) { return 'OK' }
    Start-Sleep -Seconds 3
  }
  return $opResult
}

function Unblock-HotspotPolicy {
  # Policy NC_ShowSharedAccessUI=0 (Prohibit ICS) memblokir Mobile Hotspot diam-diam
  $polKey = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Network Connections'
  try {
    $val = (Get-ItemProperty -Path $polKey -Name NC_ShowSharedAccessUI -ErrorAction SilentlyContinue).NC_ShowSharedAccessUI
    if ($null -ne $val) {
      Set-Content -Path (Join-Path $Dir 'policy-backup.txt') -Value "NC_ShowSharedAccessUI=$val"
      Remove-ItemProperty -Path $polKey -Name NC_ShowSharedAccessUI -ErrorAction Stop
      Restart-Service icssvc -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      return $true
    }
  } catch { }
  return $false
}

# --- Pastikan policy pemblokir tidak aktif ---
if (Unblock-HotspotPolicy) { Log 'Policy pemblokir hotspot (NC_ShowSharedAccessUI) dinonaktifkan.' }

# --- Matikan fitur auto-off hotspot saat tidak ada klien ---
try {
  if ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::IsNoConnectionsTimeoutEnabled()) {
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::DisableNoConnectionsTimeout()
    Log 'Auto-off hotspot (tanpa klien) dinonaktifkan.'
  }
} catch { }

# --- Lapor status awal setelah boot/restart ---
try {
  $st0 = Get-HotspotState
  if ($st0 -eq 'ON' -or $st0 -eq 'OFF') {
    $body0 = @{ device_id = $cfg.device_id; token = $cfg.token; hotspot = $st0; error = '' } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$($cfg.server)/api/status" -Method Post -ContentType 'application/json; charset=utf-8' -Body $body0 -UseBasicParsing -TimeoutSec 20
  }
} catch { Log "report-startup GAGAL: $($_.Exception.Message)" }

# --- Loop utama ---
$lastPollErr = ''
while ($true) {
  try {
    $pollBody = @{ device_id = $cfg.device_id; token = $cfg.token } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$($cfg.server)/api/poll" -Method Post -ContentType 'application/json; charset=utf-8' -Body $pollBody -UseBasicParsing -TimeoutSec 20
    if ($resp.command -eq 'ON' -or $resp.command -eq 'OFF') {
      $cmd = $resp.command
      $on = ($cmd -eq 'ON')
      $state = ''
      $err = ''

      # Kalau sudah sesuai kondisi, tidak perlu aksi apa pun
      try {
        $current = Get-HotspotState
        if (($on -and $current -eq 'ON') -or (-not $on -and $current -eq 'OFF')) { $state = $current }
      } catch { }

      if ($state -eq '') {
        try {
          $st = Set-HotspotState -On $on
          if ($st -eq 'OK') { $state = if ($on) { 'ON' } else { 'OFF' } } else { $err = "WinRT: $st" }
        } catch { $err = $_.Exception.Message }
      }

      # Fallback: netsh hosted network (adapter lama)
      if ($state -eq '') {
        try {
          if ($on) {
            $null = netsh wlan set hostednetwork mode=allow ssid=Store_Guest key=ABAGUEST26 2>&1
            $null = netsh wlan start hostednetwork 2>&1
          } else {
            $null = netsh wlan stop hostednetwork 2>&1
          }
          if ($LASTEXITCODE -eq 0) { $state = if ($on) { 'ON' } else { 'OFF' }; $err = '' } else { $err = "$err; netsh exit $LASTEXITCODE" }
        } catch { $err = "$err; $($_.Exception.Message)" }
      }

      if ($state -eq '') { $state = 'ERROR' }
      try {
        $body = @{ device_id = $cfg.device_id; token = $cfg.token; hotspot = $state; error = $err } | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "$($cfg.server)/api/status" -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -UseBasicParsing -TimeoutSec 20
      } catch { Log "report GAGAL (state=$state): $($_.Exception.Message)" }
      Log "command=$cmd state=$state error=$err"
    }
  } catch {
    if ($_.Exception.Message -ne $lastPollErr) {
      Log "poll GAGAL: $($_.Exception.Message)"
      $lastPollErr = $_.Exception.Message
    }
  }
  Start-Sleep -Seconds $interval
}
