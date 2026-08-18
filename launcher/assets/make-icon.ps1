# Regenerates launcher/assets/app.ico from System.Drawing shapes: a dark
# rounded square, a green state dot, and a white D glyph. PNG-in-ICO entries at
# 256/48/32/16 px. Run: pwsh -File launcher/assets/make-icon.ps1
param()
Add-Type -AssemblyName System.Drawing

function New-IconPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $margin = [Math]::Max(1, [int]($size / 16))
    $body = [int]($size - 2 * $margin)
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 36, 48))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [int]($body / 4)
    $path.AddArc($margin, $margin, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($margin + $body - 2 * $r, $margin, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($margin + $body - 2 * $r, $margin + $body - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc($margin, $margin + $body - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bg, $path)

    $dotColor = [System.Drawing.Color]::FromArgb(46, 158, 91)
    $dot = New-Object System.Drawing.SolidBrush($dotColor)
    $dotSize = [int]($size * 0.16)
    if ($dotSize -ge 3) {
        $g.FillEllipse($dot, [int]($size * 0.74), [int]($size * 0.74), $dotSize, $dotSize)
    }

    $fg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $fontSize = $size * 0.52
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, [float]($size * 0.03), $size, $size)
    $g.DrawString('D', $font, $fg, $rect, $format)

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return ,$ms.ToArray()
}

$sizes = @(256, 48, 32, 16)
$pngs = @()
foreach ($s in $sizes) { $pngs += ,(New-IconPng $s) }

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([uint16]0)   # reserved
$bw.Write([uint16]1)   # type: icon
$bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$dim)       # width
    $bw.Write([byte]$dim)       # height
    $bw.Write([byte]0)          # palette
    $bw.Write([byte]0)          # reserved
    $bw.Write([uint16]1)        # planes
    $bw.Write([uint16]32)       # bpp
    $bw.Write([uint32]$pngs[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $bw.Write($png) }
$bw.Flush()

$dest = Join-Path $PSScriptRoot 'app.ico'
[System.IO.File]::WriteAllBytes($dest, $out.ToArray())
Write-Host "wrote $dest ($((Get-Item $dest).Length) bytes)"
