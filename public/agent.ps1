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

# --- Helper WinRT ---
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
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
  if ($On) {
    $res = Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  } else {
    $res = Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  }
  return $res.Status.ToString()
}

# --- Lapor status awal setelah boot/restart ---
try {
  $st0 = Get-HotspotState
  if ($st0 -eq 'ON' -or $st0 -eq 'OFF') {
    $body0 = @{ device_id = $cfg.device_id; token = $cfg.token; hotspot = $st0; error = '' } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$($cfg.server)/api/report" -Method Post -ContentType 'application/json; charset=utf-8' -Body $body0 -UseBasicParsing -TimeoutSec 20
  }
} catch { }

# --- Loop utama ---
while ($true) {
  try {
    $resp = Invoke-RestMethod -Uri "$($cfg.server)/api/poll?device_id=$($cfg.device_id)&token=$($cfg.token)" -UseBasicParsing -TimeoutSec 20
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
          if ($st -eq 'Success') { $state = if ($on) { 'ON' } else { 'OFF' } } else { $err = "WinRT: $st" }
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
        $null = Invoke-RestMethod -Uri "$($cfg.server)/api/report" -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -UseBasicParsing -TimeoutSec 20
      } catch { }
      Log "command=$cmd state=$state error=$err"
    }
  } catch { }
  Start-Sleep -Seconds $interval
}
