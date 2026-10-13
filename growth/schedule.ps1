# Optional: run the growth workflows with Windows Task Scheduler instead of n8n (free, built in).
# Not run automatically. To install:   pwsh -File growth\schedule.ps1 -Install
# To remove everything:                pwsh -File growth\schedule.ps1 -Remove
# The scripts themselves respect growth\config.json (pause + kill switch), so publishing stays off
# until you turn the kill switch off.
param([switch]$Install, [switch]$Remove)
$root = Split-Path -Parent $PSScriptRoot
$tasks = @(
  @{ Name = 'CW-A-Generate'; Cmd = 'npm run build; npm run growth:generate -- --days 7'; Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9am },
  @{ Name = 'CW-B-Publish';  Cmd = 'npm run growth:publish'; Trigger = New-ScheduledTaskTrigger -Once -At 12am -RepetitionInterval (New-TimeSpan -Hours 2) },
  @{ Name = 'CW-C-Report';   Cmd = 'npm run growth:report; node growth/marketing/suggest.mjs'; Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8am }
)
foreach ($t in $tasks) {
  if ($Remove) { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "removed $($t.Name)"; continue }
  if ($Install) {
    $action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument "-NoProfile -Command `"cd '$root'; $($t.Cmd)`""
    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger -Description 'Compound Wahala growth workflow' -Force | Out-Null
    Write-Host "installed $($t.Name)"
  }
}
if (-not $Install -and -not $Remove) { Write-Host 'Use -Install or -Remove' }
