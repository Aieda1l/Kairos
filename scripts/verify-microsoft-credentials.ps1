# Verifies Entra application credentials without saving or displaying secrets.
# Run interactively from the Kairos project root in Windows PowerShell or pwsh.
# This probes the app-only token endpoint; delegated OAuth still requires a
# matching Web redirect URL and suitable account/consent configuration.
param(
  [ValidateSet("Both", "SignIn", "Calendar")]
  [string]$Flow = "Both"
)

$ErrorActionPreference = "Stop"
$validGuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
$hadFailure = $false

function Get-SafeMicrosoftError($errorRecord) {
  $result = @{ Code = "unknown"; Aadsts = "none"; HttpStatus = "unknown" }
  $raw = $errorRecord.ErrorDetails.Message
  $response = $errorRecord.Exception.Response
  if ($null -ne $response) {
    try { $result.HttpStatus = [int]$response.StatusCode } catch { }
  }
  # Windows PowerShell 5.1 frequently places the HTTP error body only in the
  # response stream. Never print that body or the original exception.
  if (-not $raw -and $response -is [System.Net.HttpWebResponse]) {
    try {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } catch { }
  }
  if ($raw) {
    try {
      $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
      $knownCodes = @("invalid_client", "unauthorized_client", "invalid_scope", "invalid_request", "invalid_resource", "temporarily_unavailable", "server_error")
      if ($parsed.error -in $knownCodes) { $result.Code = $parsed.error }
      $match = [regex]::Match([string]$parsed.error_description, 'AADSTS([0-9]{4,7})')
      if ($match.Success) { $result.Aadsts = $match.Groups[1].Value }
    } catch { }
  }
  return $result
}

$flows = if ($Flow -eq "Both") { @("SignIn", "Calendar") } else { @($Flow) }
foreach ($item in $flows) {
  $label = if ($item -eq "SignIn") { "Kairos Microsoft sign-in" } else { "Kairos Microsoft Calendar" }
  $redirect = if ($item -eq "SignIn") {
    "https://mykairos.me/api/auth/callback/microsoft-entra-id"
  } else {
    "https://mykairos.me/api/calendars/microsoft/callback"
  }
  Write-Output ""
  Write-Output "Checking $label. In Entra, verify the following URL is registered under Authentication > Web:"
  Write-Output $redirect
  if ($item -eq "Calendar") {
    Write-Output "The UUID below is only for this app-only credential probe. For personal Outlook calendar OAuth, keep Cloudflare's MICROSOFT_CALENDAR_TENANT set to 'common' (personal + work/school) or 'consumers' (personal only), not the default directory UUID."
  }
  $tenant = Read-Host "$label Directory (tenant) ID from App registrations > Overview (UUID)"
  if ($tenant -notmatch $validGuid) {
    Write-Output "INVALID FORMAT: enter the actual Directory (tenant) UUID. 'common', 'organizations', and 'consumers' cannot be used for this app-only check."
    $hadFailure = $true
    continue
  }
  $clientId = Read-Host "$label Application (client) ID (UUID)"
  if ($clientId -notmatch $validGuid) {
    Write-Output "INVALID FORMAT: use the Application (client) ID, not the secret ID or secret value."
    $hadFailure = $true
    continue
  }
  $secret = Read-Host "$label client secret VALUE (input hidden)" -AsSecureString
  $credential = New-Object System.Net.NetworkCredential("", $secret)
  $secretValue = $credential.Password
  try {
    $uri = "https://login.microsoftonline.com/$tenant/oauth2/v2.0/token"
    $body = @{
      client_id = $clientId
      client_secret = $secretValue
      grant_type = "client_credentials"
      scope = "https://graph.microsoft.com/.default"
    }
    $response = Invoke-WebRequest -Uri $uri -Method Post -ContentType "application/x-www-form-urlencoded" -Body $body -UseBasicParsing -ErrorAction Stop
    if ([int]$response.StatusCode -eq 200) {
      Write-Output "PASS: Microsoft accepted this client ID + secret value + tenant for an app-only token."
      Write-Output "Next check the Web redirect URI, supported account types, and delegated Graph permissions."
    } else {
      $hadFailure = $true
      Write-Output "INCONCLUSIVE: Microsoft returned an unexpected response status."
    }
  } catch {
    $hadFailure = $true
    $safe = Get-SafeMicrosoftError $_
    Write-Output "FAILED OR INCONCLUSIVE: HTTP=$($safe.HttpStatus) provider=$($safe.Code) AADSTS=$($safe.Aadsts)"
    switch ($safe.Aadsts) {
      "7000215" { Write-Output "Secret rejected. Use the secret VALUE, check expiration and ensure it belongs to this client ID." }
      "7000222" { Write-Output "Secret expired. Create a new secret VALUE in the matching app registration." }
      "700016"  { Write-Output "Application not found in this tenant. Check client ID, tenant ID, and account types." }
      "7000218" { Write-Output "Microsoft requires a client secret or assertion for this application." }
      default { Write-Output "Review this AADSTS code in Entra sign-in logs. Failure can also reflect app-only permissions or tenant policy." }
    }
  } finally {
    $body = $null
    $secretValue = $null
    $credential = $null
    $secret = $null
  }
}
Write-Output ""
Write-Output "This checks the entered values, not Cloudflare's stored secrets. An app-only PASS does not verify delegated OAuth redirects or consent."
Write-Output "The app-only probe requires a directory UUID, but that does not mean Calendar OAuth should use that UUID. Personal Outlook accounts require a personal-account-compatible authority and app registration."
Write-Output "If a flow passes but Kairos still fails, compare and securely update its matching Cloudflare production secrets, then retry OAuth."
if ($hadFailure) { exit 1 }
