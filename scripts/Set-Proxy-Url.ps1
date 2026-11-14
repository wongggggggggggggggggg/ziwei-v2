# Set-Proxy-Url.ps1  (ASCII only, Windows PowerShell 5.1 compatible)
# Purpose: build a PUBLIC copy of ziwei-ai-v2.html that talks to your own
#          Cloudflare Worker proxy. The API key stays on the Worker, so the
#          resulting file is safe to publish.

[CmdletBinding()]
param(
  [string]$Url = ""
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

$template = Get-ChildItem -Path $root -Filter "ziwei-ai-v2.html" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\private\\' -and $_.FullName -notmatch '\\public\\' } |
  Select-Object -First 1

if (-not $template) {
  Write-Host "ERROR: ziwei-ai-v2.html not found under $root" -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Url)) {
  $Url = Read-Host "Paste your Worker URL (https://xxx.workers.dev)"
}

$Url = $Url.Trim().TrimEnd('/')
if ($Url -notmatch '^https://[A-Za-z0-9\.\-]+(:[0-9]+)?(/[A-Za-z0-9\.\-_/]*)?$') {
  Write-Host "ERROR: URL must start with https:// and contain no spaces. Aborting." -ForegroundColor Red
  exit 1
}

$html = [System.IO.File]::ReadAllText($template.FullName, [System.Text.Encoding]::UTF8)

$needle = 'PROXY_URL: "",'
$count = ([regex]::Matches($html, [regex]::Escape($needle))).Count
if ($count -ne 1) {
  Write-Host "ERROR: expected exactly 1 PROXY_URL placeholder, found $count. Aborting." -ForegroundColor Red
  exit 1
}
$html = $html.Replace($needle, ('PROXY_URL: "' + $Url + '",'))

$uri = [System.Uri]$Url
$hostName = $uri.Host
if ($hostName -notlike "*.workers.dev") {
  $cspOld = "https://api.deepseek.com https://*.workers.dev"
  $cspNew = "https://api.deepseek.com https://*.workers.dev https://" + $hostName
  if ($html.Contains($cspOld)) {
    $html = $html.Replace($cspOld, $cspNew)
    Write-Host "CSP updated: added https://$hostName to connect-src"
  } else {
    Write-Host "WARNING: could not find CSP connect-src pattern. Add https://$hostName manually." -ForegroundColor Yellow
  }
}

$outDir = Join-Path (Split-Path -Parent $template.FullName) "public"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $outDir ("ziwei-ai-v2-public-" + $stamp + ".html")

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outFile, $html, $utf8NoBom)

Write-Host ""
Write-Host "OK  public build written:" -ForegroundColor Green
Write-Host "    $outFile"
Write-Host "    proxy = $Url/chat"
Write-Host ""
Write-Host "REMINDERS" -ForegroundColor Yellow
Write-Host "  1. This file has NO API key. Safe to publish."
Write-Host "  2. Worker must have DEEPSEEK_API_KEY set as an encrypted secret."
Write-Host "  3. Worker ALLOWED_ORIGINS must include the origin you deploy to."
Write-Host ""
