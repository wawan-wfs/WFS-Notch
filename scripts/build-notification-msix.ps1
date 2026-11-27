# Requires exact x64 release EXE, Windows SDK and an existing trusted signing certificate.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [string]$CertificateThumbprint,
  [switch]$PackageValidationOnly,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exePath = (Resolve-Path -LiteralPath $Exe).Path
if ([IO.Path]::GetFileName($exePath) -ne 'wfs-notch.exe') { throw 'Select the exact WFS Notch release EXE.' }
$make = (Get-Command makeappx.exe -ErrorAction Stop).Source
if (-not $PackageValidationOnly) {
  if (-not $CertificateThumbprint) { throw 'Trusted signing certificate thumbprint required.' }
  $sign = (Get-Command signtool.exe -ErrorAction Stop).Source
  $cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
  if (-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date)) { throw 'Valid existing signing certificate required.' }
} elseif ($CertificateThumbprint) { throw 'Do not provide a certificate for validation-only mode.' }
$outPath = [IO.Path]::GetFullPath($Output)
if ([IO.Path]::GetExtension($outPath) -ne '.msix' -or (Test-Path -LiteralPath $outPath)) { throw 'Choose a new .msix output path.' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('wfs-notch-msix-'+[guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null
  Copy-Item -LiteralPath $exePath -Destination (Join-Path $stage 'wfs-notch.exe')
  [xml]$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'packaging/AppxManifest.xml')
  if (-not $PackageValidationOnly) { $manifest.Package.Identity.Publisher = $cert.Subject }
  $manifest.Save((Join-Path $stage 'AppxManifest.xml'))
  Add-Type -AssemblyName System.Drawing
  $source = [System.Drawing.Image]::FromFile((Join-Path $root 'src-tauri/icons/256x256.png'))
  try {
    foreach ($logo in @(@('StoreLogo.png',50),@('Square150x150Logo.png',150),@('Square44x44Logo.png',44))) {
      $bitmap = [System.Drawing.Bitmap]::new([int]$logo[1],[int]$logo[1])
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.DrawImage($source,0,0,[int]$logo[1],[int]$logo[1]) }
        finally { $graphics.Dispose() }
        $bitmap.Save((Join-Path (Join-Path $stage 'Assets') $logo[0]),[System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $bitmap.Dispose() }
    }
  } finally { $source.Dispose() }
  & $make pack /d $stage /p $outPath
  if ($LASTEXITCODE -ne 0) { throw 'MakeAppx failed.' }
  if ($PackageValidationOnly) {
    Write-Warning 'Unsigned MSIX schema/pack validation only; not installable acceptance evidence.'
  } else {
    & $sign sign /fd SHA256 /sha1 $cert.Thumbprint $outPath
    if ($LASTEXITCODE -ne 0) { throw 'Signing failed; do not install unsigned package.' }
    & $sign verify /pa /v $outPath
    if ($LASTEXITCODE -ne 0) { throw 'Package signature verification failed.' }
  }
  Get-FileHash -LiteralPath $outPath -Algorithm SHA256
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
