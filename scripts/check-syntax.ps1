$ErrorActionPreference = 'Stop'
$files = @('scripts\install-agent.ps1', 'public\agent.ps1')
$failed = $false
foreach ($f in $files) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors -and $errors.Count -gt 0) {
    $failed = $true
    Write-Host "SYNTAX ERROR di $f"
    $errors | ForEach-Object { Write-Host $_.Message }
  } else {
    Write-Host "OK  $f"
  }
}
if ($failed) { exit 1 }
