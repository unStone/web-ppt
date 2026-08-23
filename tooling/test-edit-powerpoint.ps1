param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $Path).Path
$powerPoint = $null
$presentation = $null

try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  # ppAlertsAll=2 会把提示作为自动化错误返回；OpenAndRepair=msoFalse=0 禁止静默修复。
  $powerPoint.DisplayAlerts = 2
  $presentation = $powerPoint.Presentations.Open2007($resolved, -1, 0, 0, 0)
  if ($presentation.Slides.Count -lt 1) {
    throw 'PowerPoint 打开的演示文稿没有页面'
  }
  Write-Host "PowerPoint 未启用修复即打开 $($presentation.Slides.Count) 页：$resolved"
}
finally {
  if ($null -ne $presentation) {
    $presentation.Saved = -1
    $presentation.Close()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
  }
  if ($null -ne $powerPoint) {
    $powerPoint.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
