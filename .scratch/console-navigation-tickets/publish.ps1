$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
$ticketCredentialLines = @('protocol=https','host=github.com','') | git credential fill 2>$null
$ticketCredentialFields = @{}
foreach ($ticketCredentialLine in $ticketCredentialLines) {
  $ticketCredentialPair = $ticketCredentialLine -split '=',2
  if ($ticketCredentialPair.Count -eq 2) { $ticketCredentialFields[$ticketCredentialPair[0]] = $ticketCredentialPair[1] }
}
if (!$ticketCredentialFields.ContainsKey('password')) { throw 'GitHub credential unavailable.' }
$ticketHeaders = @{ Authorization = "Bearer $($ticketCredentialFields['password'])"; Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' }
$ticketApiBase = 'https://api.github.com/repos/BenXueYou/ai-research-company'
function Invoke-TicketApi([string]$Method, [string]$Suffix, $Payload = $null) {
  $ticketRequest = @{ Uri="$ticketApiBase$Suffix"; Method=$Method; Headers=$ticketHeaders }
  if ($null -ne $Payload) {
    $ticketRequest['Body'] = [System.Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Depth 20 -Compress))
    $ticketRequest['ContentType'] = 'application/json; charset=utf-8'
  }
  try {
    $ticketApiResult = Invoke-RestMethod @ticketRequest
    foreach ($ticketApiItem in $ticketApiResult) { $ticketApiItem }
  }
  catch { throw "GitHub $Method $Suffix failed; HTTP $([int]$_.Exception.Response.StatusCode)." }
}
$ticketRoot = $PSScriptRoot
$ticketDefinitions = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $ticketRoot 'tickets.json') | ConvertFrom-Json
$ticketUtf8 = New-Object System.Text.UTF8Encoding($false)
$ticketExisting = @()
$ticketPage = 1
do {
  $ticketPageIssues = @(Invoke-TicketApi GET "/issues?state=all&per_page=100&page=$ticketPage")
  $ticketExisting += $ticketPageIssues
  $ticketPage++
} while ($ticketPageIssues.Count -eq 100)
$ticketLabels = @(Invoke-TicketApi GET '/labels?per_page=100')
if (!($ticketLabels | Where-Object name -eq 'ready-for-agent')) {
  $null = Invoke-TicketApi POST '/labels' @{ name='ready-for-agent'; color='0e8a16'; description='Ready for agent implementation' }
}
$ticketPublished = @{}
$ticketManifest = @()
foreach ($ticket in $ticketDefinitions) {
  $ticketOrdinal = [int]$ticket.ordinal
  $ticketBody = [string]$ticket.body
  foreach ($ticketBlocker in $ticket.blockedBy) {
    if (!$ticketPublished.ContainsKey([int]$ticketBlocker)) { throw "Unpublished blocker $ticketBlocker for $ticketOrdinal" }
  }
  $ticketBody = [regex]::Replace($ticketBody, '(?m)^- 草案 (\d+) — .*（发布时替换为真实 Issue 引用）。$', {
    param($ticketMatch)
    $ticketBlockerIssue = $ticketPublished[[int]$ticketMatch.Groups[1].Value]
    return "- #$($ticketBlockerIssue.number) — $($ticketBlockerIssue.title)"
  })
  $ticketMarker = '<!-- console-navigation-v1-ticket-' + $ticketOrdinal.ToString('00') + ' -->'
  $ticketMatches = @($ticketExisting | Where-Object { !$_.pull_request -and $_.body -and $_.body.Contains($ticketMarker) })
  if ($ticketMatches.Count -gt 1) { throw "Duplicate marker for ticket $ticketOrdinal" }
  if ($ticketMatches.Count -eq 1) {
    $ticketIssue = $ticketMatches[0]
    if ($ticketIssue.title -cne $ticket.title -or $ticketIssue.body.Replace("`r`n","`n") -cne $ticketBody.Replace("`r`n","`n")) { throw "Existing ticket $ticketOrdinal differs; refusing overwrite." }
  } else {
    $ticketIssue = Invoke-TicketApi POST '/issues' @{ title=$ticket.title; body=$ticketBody; labels=@('ready-for-agent') }
  }
  $ticketPublished[$ticketOrdinal] = $ticketIssue
  [IO.File]::WriteAllText((Join-Path $ticketRoot ($ticketOrdinal.ToString('00') + '-issue.md')), $ticketBody, $ticketUtf8)
  $ticketManifest += [pscustomobject]@{ ordinal=$ticketOrdinal; batch=$ticket.batch; number=$ticketIssue.number; id=$ticketIssue.id; title=$ticketIssue.title; url=$ticketIssue.html_url; blockedBy=@($ticket.blockedBy); verified=$false }
  [IO.File]::WriteAllText((Join-Path $ticketRoot 'published.json'), (ConvertTo-Json -InputObject $ticketManifest -Depth 10), $ticketUtf8)
  Write-Output "Published $ticketOrdinal -> #$($ticketIssue.number)"
}
foreach ($ticket in $ticketDefinitions) {
  $ticketIssue = $ticketPublished[[int]$ticket.ordinal]
  $ticketCurrentEdges = @(Invoke-TicketApi GET "/issues/$($ticketIssue.number)/dependencies/blocked_by?per_page=100")
  foreach ($ticketBlocker in $ticket.blockedBy) {
    $ticketBlockerIssue = $ticketPublished[[int]$ticketBlocker]
    if (!($ticketCurrentEdges | Where-Object id -eq $ticketBlockerIssue.id)) {
      $null = Invoke-TicketApi POST "/issues/$($ticketIssue.number)/dependencies/blocked_by" @{ issue_id=$ticketBlockerIssue.id }
    }
  }
  Write-Output "Dependencies set for #$($ticketIssue.number)"
}
foreach ($ticketEntry in $ticketManifest) {
  $ticketReadback = Invoke-TicketApi GET "/issues/$($ticketEntry.number)"
  $ticketExpectedBody = [IO.File]::ReadAllText((Join-Path $ticketRoot ($ticketEntry.ordinal.ToString('00') + '-issue.md')))
  if ($ticketReadback.title -cne $ticketEntry.title -or $ticketReadback.body.Replace("`r`n","`n") -cne $ticketExpectedBody.Replace("`r`n","`n")) { throw "Content mismatch #$($ticketEntry.number)" }
  if ($ticketReadback.state -ne 'open' -or !($ticketReadback.labels | Where-Object name -eq 'ready-for-agent')) { throw "State/label mismatch #$($ticketEntry.number)" }
  $ticketReadEdges = @(Invoke-TicketApi GET "/issues/$($ticketEntry.number)/dependencies/blocked_by?per_page=100")
  $ticketExpectedIds = @($ticketEntry.blockedBy | ForEach-Object { $ticketPublished[[int]$_].id } | Sort-Object)
  $ticketActualIds = @($ticketReadEdges | ForEach-Object { $_.id } | Sort-Object)
  if (($ticketExpectedIds -join ',') -ne ($ticketActualIds -join ',')) { throw "Dependency mismatch #$($ticketEntry.number)" }
  $ticketEntry.verified = $true
  Write-Output "Verified #$($ticketEntry.number)"
}
[IO.File]::WriteAllText((Join-Path $ticketRoot 'published.json'), (ConvertTo-Json -InputObject $ticketManifest -Depth 10), $ticketUtf8)
Write-Output "COMPLETE: $($ticketManifest.Count) issues, all content/labels/native dependencies verified."
