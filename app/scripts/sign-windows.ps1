param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Pfx,
  [string]$Password
)

$ErrorActionPreference = "Stop"
$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
if (-not (Test-Path $signtool)) {
  throw "Не найден signtool из Windows SDK"
}
if (-not (Test-Path $Exe)) {
  throw "Не найден исполняемый файл: $Exe"
}

if ($Pfx) {
  & $signtool sign /f $Pfx /p $Password /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $Exe
  Write-Host "Подписано сертификатом: $Pfx"
} else {
  $devCert = Join-Path $env:TEMP "amadeus-dev-signing.pfx"
  $secure = ConvertTo-SecureString "amadeus-dev-only" -AsPlainText -Force
  $cert = New-SelfSignedCertificate -Type CodeSigning -Subject "CN=Amadeus Dev" -CertStoreLocation "Cert:\CurrentUser\My" -KeyUsage DigitalSignature -FriendlyName "Amadeus Dev"
  Export-PfxCertificate -Cert $cert -FilePath $devCert -Password $secure | Out-Null
  & $signtool sign /f $devCert /p "amadeus-dev-only" /fd SHA256 $Exe
  Write-Host "Подписано самоподписанным сертификатом разработчика (антивирусы всё равно могут ругаться)."
}
