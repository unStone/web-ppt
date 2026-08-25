param(
  [Parameter(Mandatory = $true)]
  [string]$Manifest,

  [string]$Report = 'out/edit-save/powerpoint-report.json'
)

$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path $Manifest).Path
$manifestDir = Split-Path -Parent $manifestPath
$reportPath = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Report))
$reportDir = Split-Path -Parent $reportPath
if (-not (Test-Path -LiteralPath $reportDir)) {
  [void](New-Item -ItemType Directory -Path $reportDir -Force)
}
$payload = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($payload.version -ne 1 -or $payload.artifacts.Count -lt 1) {
  throw "PowerPoint 验收清单无效：$manifestPath"
}
$powerPoint = $null
$opened = 0
$evidence = @()
$failureMessage = $null
$powerPointVersion = $null
$powerPointBuild = $null
$sessionId = (Get-Process -Id $PID).SessionId
$sourceRevision = $null

try {
  if (-not [Environment]::UserInteractive -or $sessionId -le 0) {
    throw 'PowerPoint COM 门禁必须由已登录用户在交互式 Windows 桌面会话运行，不能把 runner 安装为 Session 0 服务'
  }

  $sourceRevision = (& git rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceRevision)) {
    throw '无法读取当前 Git revision，证据不能绑定到源码提交'
  }
  $sourceRevision = $sourceRevision.Trim()
  $worktreeState = (& git status --porcelain=v1 --untracked-files=all 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw '无法读取当前 Git 工作树状态'
  }
  if (-not [string]::IsNullOrWhiteSpace($worktreeState)) {
    throw '当前 Git 工作树不干净，不能生成只绑定到 HEAD 的 PowerPoint 证据'
  }

  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPointVersion = [string]$powerPoint.Version
  $powerPointBuild = [string]$powerPoint.Build
  # ppAlertsAll=2 会把提示作为自动化错误返回；OpenAndRepair=msoFalse=0 禁止静默修复。
  $powerPoint.DisplayAlerts = 2

  foreach ($artifact in $payload.artifacts) {
    $presentation = $null
    if ([string]::IsNullOrWhiteSpace($artifact.file) -or
        [IO.Path]::GetFileName($artifact.file) -ne $artifact.file) {
      throw "PowerPoint 验收清单只能引用同目录文件：$($artifact.file)"
    }
    $resolved = (Resolve-Path (Join-Path $manifestDir $artifact.file)).Path
    try {
      $presentation = $powerPoint.Presentations.Open2007($resolved, -1, 0, 0, 0)
      if ($presentation.Slides.Count -ne $artifact.slides) {
        throw "PowerPoint 打开 $($artifact.file) 得到 $($presentation.Slides.Count) 页，预期 $($artifact.slides) 页"
      }
      $evidence += [ordered]@{
        file = [string]$artifact.file
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash.ToLowerInvariant()
        expectedSlides = [int]$artifact.slides
        actualSlides = [int]$presentation.Slides.Count
        openedWithoutRepair = $true
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
catch {
  $failureMessage = $_.Exception.Message
}
finally {
  if ($null -ne $powerPoint) {
    try {
      $powerPoint.Quit()
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
    }
    catch {
      if ($null -eq $failureMessage) {
        $failureMessage = "PowerPoint 清理失败：$($_.Exception.Message)"
      }
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

if ($null -eq $failureMessage -and $opened -ne $payload.artifacts.Count) {
  $failureMessage = "PowerPoint 仅验证 $opened/$($payload.artifacts.Count) 份保存产物"
}
$passed = $null -eq $failureMessage
$reportPayload = [ordered]@{
  version = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  sourceRevision = $sourceRevision
  manifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()
  powerPoint = if ($null -eq $powerPointVersion) { $null } else { [ordered]@{
    version = $powerPointVersion
    build = $powerPointBuild
  }}
  environment = [ordered]@{
    userInteractive = [Environment]::UserInteractive
    sessionId = $sessionId
  }
  artifacts = $evidence
  passed = $passed
  failure = $failureMessage
}
$reportJson = $reportPayload | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($reportPath, "$reportJson`n", $utf8NoBom)
Write-Host "PowerPoint 门禁证据：$reportPath"

if (-not $passed) {
  throw $failureMessage
}
