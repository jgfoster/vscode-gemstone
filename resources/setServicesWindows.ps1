# Add `gs64ldi 50377/tcp` to the Windows services file so GemStone logins
# can name the NetLDI port as "gs64ldi" (matches the convention also used
# on macOS/Linux /etc/services and inside WSL).
#
# Requires elevation. Idempotent: leaves the file untouched if the entry
# is already present.

param()

$ErrorActionPreference = 'Stop'

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($currentIdentity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $scriptPath = $MyInvocation.MyCommand.Path
    if (-not $scriptPath) {
        Write-Error "Cannot self-elevate: script path unknown. Re-run from an elevated PowerShell."
        exit 1
    }
    Write-Host "This script needs to modify the Windows services file and will request elevation..."
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`""
    exit 0
}

$servicesPath = Join-Path $env:SystemRoot 'System32\drivers\etc\services'
if (-not (Test-Path $servicesPath)) {
    Write-Error "Services file not found at $servicesPath."
    exit 2
}

$existing = Get-Content -LiteralPath $servicesPath -Encoding Default

# Match any existing `gs64ldi ... /tcp` line (ignoring comments). If it
# exists, leave the file alone rather than appending a second entry.
if ($existing | Where-Object { $_ -match '^\s*gs64ldi\s+\d+/tcp\b' }) {
    Write-Host "Services file already has a gs64ldi entry; no change made."
} else {
    $newLine = "gs64ldi`t`t50377/tcp`t`t# GemStone/S NetLDI"
    $newContent = @($existing) + @($newLine)
    Set-Content -LiteralPath $servicesPath -Value $newContent -Encoding Default
    Write-Host "Added 'gs64ldi 50377/tcp' to $servicesPath."
}

if ($Host.Name -eq 'ConsoleHost') {
    Write-Host ""
    Write-Host "Press Enter to close..."
    [void][System.Console]::ReadLine()
}
