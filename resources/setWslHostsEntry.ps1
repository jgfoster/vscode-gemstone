# Add or refresh a `wsl-linux` entry in the Windows hosts file so GemStone
# logins can use the name `wsl-linux` instead of a raw WSL IP.
#
# WSL2 (without mirrored networking) assigns a new IP every time the VM
# restarts, so this script is idempotent: safe to re-run after every reboot.
#
# Requires elevation. If launched unelevated, it self-relaunches via UAC.

param()

$ErrorActionPreference = 'Stop'

# Self-elevate when needed. Note: we can't use the original $PSCommandPath
# reliably from an unelevated shell launched without -File, so we pass our
# own $MyInvocation.MyCommand.Path when available.
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($currentIdentity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $scriptPath = $MyInvocation.MyCommand.Path
    if (-not $scriptPath) {
        Write-Error "Cannot self-elevate: script path unknown. Re-run from an elevated PowerShell."
        exit 1
    }
    Write-Host "This script needs to modify the Windows hosts file and will request elevation..."
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`""
    exit 0
}

# Probe the WSL IP. hostname -I inside the default distro returns
# space-separated IPv4 + IPv6 addresses; the first IPv4 token is the one
# Windows should route to.
$wslOutput = & wsl.exe -e hostname -I 2>$null
if (-not $wslOutput) {
    Write-Error "Could not read WSL IP via 'wsl.exe -e hostname -I'. Is WSL installed and running?"
    exit 2
}
$wslIp = ($wslOutput -split '\s+' | Where-Object { $_ -match '^(\d{1,3}\.){3}\d{1,3}$' } | Select-Object -First 1)
if (-not $wslIp) {
    Write-Error "WSL returned no IPv4 address."
    exit 2
}

$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$existing = if (Test-Path $hostsPath) { Get-Content -LiteralPath $hostsPath -Encoding Default } else { @() }

# Strip any previous wsl-linux line so we don't accumulate stale IPs.
$filtered = $existing | Where-Object { $_ -notmatch '^\s*\S+\s+wsl-linux\b' }

# Append the fresh entry. Use Tab separator — matches the hosts file
# convention and keeps the name column aligned on most systems.
$newLine = "$wslIp`twsl-linux`t# GemStone/Jasper — refresh after WSL restart"
$newContent = @($filtered) + @($newLine)

# Preserve the original line-ending style — hosts is traditionally CRLF.
Set-Content -LiteralPath $hostsPath -Value $newContent -Encoding Default

Write-Host "Wrote '$wslIp wsl-linux' to $hostsPath."
Write-Host "Re-run this script after 'wsl --shutdown' or a Windows restart to refresh the IP."

# Give the user time to read the output when launched via Start-Process.
if ($Host.Name -eq 'ConsoleHost') {
    Write-Host ""
    Write-Host "Press Enter to close..."
    [void][System.Console]::ReadLine()
}
