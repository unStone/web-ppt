param(
  [Parameter(Mandatory = $true)]
  [string]$Manifest
)

$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path $Manifest).Path
$manifestDir = Split-Path -Parent $manifestPath
$payload = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($payload.version -ne 1 -or $payload.artifacts.Count -lt 1) {
  throw "PowerPoint 验收清单无效：$manifestPath"
}
$powerPoint = $null
$opened = 0

try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  # ppAlertsAll=2 会把提示作为自动化错误返回；OpenAndRepair=msoFalse=0 禁止静默修复。
  $powerPoint.DisplayAlerts = 2

  foreach ($artifact in $payload.artifacts) {
    $presentation = $null
    $resolved = (Resolve-Path (Join-Path $manifestDir $artifact.file)).Path
    try {
      $presentation = $powerPoint.Presentations.Open2007($resolved, -1, 0, 0, 0)
      if ($presentation.Slides.Count -ne $artifact.slides) {
        throw "PowerPoint 打开 $($artifact.file) 得到 $($presentation.Slides.Count) 页，预期 $($artifact.slides) 页"
      }
      $opened++
      Write-Host "PowerPoint 未启用修复即打开 $($presentation.Slides.Count) 页：$resolved"
    }
    finally {
      if ($null -ne $presentation) {
        $presentation.Saved = -1
        $presentation.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
      }
    }
  }

  Write-Host "PowerPoint 真实软件门禁通过：$opened/$($payload.artifacts.Count) 份保存产物"
}
finally {
  if ($null -ne $powerPoint) {
    $powerPoint.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
