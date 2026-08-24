param(
  [string]$ExtensionPath = (Join-Path $PSScriptRoot "..\assets\autumn-job-tracker"),
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\autumn-job-tracker-edge-extension.zip")
)

$ErrorActionPreference = "Stop"
$resolvedExtension = (Resolve-Path -LiteralPath $ExtensionPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

& (Join-Path $PSScriptRoot "verify-extension.ps1") -ExtensionPath $resolvedExtension
Compress-Archive -Path (Join-Path $resolvedExtension "*") -DestinationPath $resolvedOutput -Force
Write-Output "Packaged extension: $resolvedOutput"
