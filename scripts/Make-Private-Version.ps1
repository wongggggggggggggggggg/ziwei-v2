# Make-Private-Version.ps1  (ASCII only, Windows PowerShell 5.1 compatible)
# Purpose: create a PRIVATE copy of ziwei-ai-v2.html with your DeepSeek API key
#          embedded in CONFIG.INLINE_API_KEY, for local use only (file:// or localhost).
# WARNING: A static HTML page with an embedded key is NOT safe on a public URL.
#          Anyone can press F12 and read it. Keep this file off the internet.

[CmdletBinding()]
param(
  [string]$Key = ""
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

# Locate the v2 template without hardcoding non-ASCII folder names.
$template = Get-ChildItem -Path $root -Filter "ziwei-ai-v2.html" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\private\\' -and $_.FullName -notmatch '\\public\\' } |
  Select-Object -First 1

if (-not $template) {
  Write-Host "ERROR: ziwei-ai-v2.html not found under $root" -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Key)) {
  $secure = Read-Host "Paste your DeepSeek API key (sk-...)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $Key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$Key = $Key.Trim()
if ($Key -notmatch '^[A-Za-z0-9_\-\.]+$') {
  Write-Host "ERROR: key contains unexpected characters. Aborting." -ForegroundColor Red
  exit 1
}
if ($Key.Length -lt 16) {
  Write-Host "ERROR: key looks too short. Aborting." -ForegroundColor Red
  exit 1
}

$html = [System.IO.File]::ReadAllText($template.FullName, [System.Text.Encoding]::UTF8)
$needle = 'INLINE_API_KEY: "",'
$count = ([regex]::Matches($html, [regex]::Escape($needle))).Count
if ($count -ne 1) {
  Write-Host "ERROR: expected exactly 1 placeholder, found $count. Template changed? Aborting." -ForegroundColor Red
  exit 1
}

$result = $html.Replace($needle, ('INLINE_API_KEY: "' + $Key + '",'))
if ($result.Contains($needle)) {
  Write-Host "ERROR: replacement failed. Aborting." -ForegroundColor Red
  exit 1
}

$outDir = Join-Path (Split-Path -Parent $template.FullName) "private"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $outDir ("ziwei-ai-v2-private-" + $stamp + ".html")

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outFile, $result, $utf8NoBom)

Write-Host ""
Write-Host "OK  private build written:" -ForegroundColor Green
Write-Host "    $outFile"
Write-Host ""
Write-Host "REMINDERS" -ForegroundColor Yellow
Write-Host "  1. This file contains your API key in plaintext. NEVER upload it, never commit it."
Write-Host "  2. For a public site use proxy mode instead (worker.js + Set-Proxy-Url.ps1)."
Write-Host "  3. If DeepSeek blocks file:// requests (CORS origin null), run Serve-Local.cmd"
Write-Host "     and open http://localhost:8080/ziwei-ai-v2.html instead."
Write-Host "  4. Keep this file offline only, or delete it when you no longer need it."
Write-Host ""
