param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inicio', 'carga', 'recuperacion', 'gitops')]
  [string]$Fase
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $repoRoot 'informe'
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$context = (& kubectl config current-context 2>&1 | Out-String).Trim()

$sections = @(
  @('kubectl get application cooperativa-web -n argocd -o wide', @('get', 'application', 'cooperativa-web', '-n', 'argocd', '-o', 'wide')),
  @('kubectl get deployment,service,hpa,pods -n gitops-demo -l app=cooperativa-web', @('get', 'deployment,service,hpa,pods', '-n', 'gitops-demo', '-l', 'app=cooperativa-web')),
  @('kubectl top pods -n gitops-demo -l app=cooperativa-web', @('top', 'pods', '-n', 'gitops-demo', '-l', 'app=cooperativa-web'))
)
if ($Fase -eq 'gitops') {
  $sections += ,@(
    'kubectl get application cooperativa-web -n argocd -o jsonpath (revision y automated)',
    @('get', 'application', 'cooperativa-web', '-n', 'argocd', '-o', "jsonpath={.status.history[-1].revision} {.status.history[-1].initiatedBy.automated}")
  )
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Fase: $Fase | Fecha: $timestamp | Contexto: $context")
$lines.Add('Salida real de comandos kubectl, renderizada para el informe.')
$lines.Add('')
foreach ($section in $sections) {
  $lines.Add('> ' + $section[0])
  $result = (& kubectl @($section[1]) 2>&1 | Out-String).TrimEnd()
  foreach ($line in ($result -split "`r?`n")) { $lines.Add($line) }
  $lines.Add('')
}

$textPath = Join-Path $outputDir "evidencia-$Fase.txt"
$pngPath = Join-Path $outputDir "evidencia-$Fase.png"
[System.IO.File]::WriteAllLines($textPath, $lines, (New-Object System.Text.UTF8Encoding($false)))

Add-Type -AssemblyName System.Drawing
$width = 1700
$lineHeight = 28
$height = [Math]::Max(540, 115 + ($lines.Count * $lineHeight))
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(20, 27, 33))
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = New-Object System.Drawing.Font('Consolas', 16)
$heading = New-Object System.Drawing.Font('Segoe UI', 25, [System.Drawing.FontStyle]::Bold)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(232, 239, 233))
$green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(102, 214, 148))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(173, 188, 180))
$graphics.DrawString('Evidencia de Kubernetes y Argo CD', $heading, $white, 30, 22)
$y = 90
foreach ($line in $lines) {
  $brush = if ($line.StartsWith('> ')) { $green } elseif ($line.StartsWith('Salida real')) { $muted } else { $white }
  $graphics.DrawString($line, $font, $brush, 30, $y)
  $y += $lineHeight
}
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$font.Dispose()
$heading.Dispose()
$white.Dispose()
$green.Dispose()
$muted.Dispose()
Write-Output $pngPath
