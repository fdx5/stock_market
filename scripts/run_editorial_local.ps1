# Local (residential IP) investment video collector for the Windows Task Scheduler.
# YouTube rejects RSS/watch pages from Render and GitHub Actions, so this host
# appends the 20-video archive that the server reads. No DB access.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:LOCALAPPDATA "KStockHub\editorial-collector.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
git -C $repo fetch -q origin main
git -C $repo checkout -q --detach origin/main
$env:GITHUB_TOKEN = ("protocol=https`nhost=github.com`n`n" | git credential fill) -match "^password=" -replace "^password=", ""
foreach ($market in "kr", "us") {
    "$(Get-Date -Format s) $market" | Out-File -Append -Encoding utf8 $log
    python -I (Join-Path $repo "scripts\refresh_editorial.py") $market --archive-only 2>&1 |
        Where-Object { $_ -match '^\{' } | Out-File -Append -Encoding utf8 $log
}
Remove-Item Env:GITHUB_TOKEN
