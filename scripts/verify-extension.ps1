param(
  [string]$ExtensionPath = (Join-Path $PSScriptRoot "..\assets\autumn-job-tracker")
)

$ErrorActionPreference = "Stop"
$resolved = (Resolve-Path -LiteralPath $ExtensionPath).Path
$required = @(
  "manifest.json", "background.js", "content.js", "extractor.js",
  "popup.html", "popup.js", "index.html", "app.js", "styles.css"
)

foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $resolved $name) -PathType Leaf)) {
    throw "Missing required extension file: $name"
  }
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $resolved "manifest.json") | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) {
  throw "Expected Manifest V3."
}
if (-not $manifest.action.default_popup) {
  throw "The extension must expose an explicit toolbar popup."
}

$content = Get-Content -Raw -LiteralPath (Join-Path $resolved "content.js")
$passiveTriggers = @("scheduleScan(350)", "new MutationObserver(() => scheduleScan", 'visibilitychange", () =>')
foreach ($trigger in $passiveTriggers) {
  if ($content.Contains($trigger)) {
    throw "Passive page capture trigger is present: $trigger"
  }
}
if (-not $content.Contains('message?.type === "SCAN_PAGE" || message?.type === "CAPTURE_PAGE"')) {
  throw "Explicit capture message handling is missing."
}

Write-Output "Extension structure and manual-capture invariant verified: $resolved"
