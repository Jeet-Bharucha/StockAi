$dir = "C:\Users\jeetb\Desktop\StockMarket"
$files = @(
  "$dir\dashboard.html",
  "$dir\login.html",
  "$dir\register.html",
  "$dir\index.html",
  "$dir\profile.html",
  "$dir\css\effects.css"
)

$replacements = @(
  # CSS custom vars
  @('--cyan:#00d4ff', '--cyan:#c084fc'),
  @('--cyan2:#0055ff', '--cyan2:#9333ea'),
  @('--bg:#050b1f', '--bg:#07030f'),
  @('--bg:#020818', '--bg:#07030f'),
  @('--sidebar:#060e1c', '--sidebar:#09041a'),
  @('--glow:rgba(0,212,255,0.4)', '--glow:rgba(192,132,252,0.4)'),
  # rgba cyan -> rgba purple
  @('rgba(0,212,255,', 'rgba(168,85,247,'),
  @('rgba(0,85,255,', 'rgba(147,51,234,'),
  @('rgba(0,100,255,', 'rgba(109,40,217,'),
  @('rgba(0,70,255,', 'rgba(109,40,217,'),
  @('rgba(0,180,255,', 'rgba(168,85,247,'),
  @('rgba(0,55,255,', 'rgba(124,58,237,'),
  @('rgba(5,11,31,', 'rgba(7,3,15,'),
  @('rgba(2,8,24,', 'rgba(7,3,15,'),
  @('rgba(6,14,28,', 'rgba(9,4,26,'),
  @('rgba(8,16,40,', 'rgba(10,4,24,'),
  @('rgba(13,27,48,', 'rgba(12,4,28,'),
  @('rgba(6,12,32,', 'rgba(9,3,22,'),
  # hex bg/sidebar colors
  @('#050b1f', '#07030f'),
  @('#020818', '#07030f'),
  @('#060e1c', '#09041a'),
  @('#0b1525', '#0c0418'),
  @('#0c0f2e', '#0c0420'),
  @('#060a1e', '#08041a'),
  @('#060b1e', '#08041a'),
  @('#0d1b30', '#0e0428'),
  # hex cyan/blue accent colors
  @('#00d4ff', '#c084fc'),
  @('#0055ff', '#9333ea'),
  # js particle colors (strings in canvas code)
  @("'#00d4ff'", "'#c084fc'"),
  @("'#0055ff'", "'#9333ea'"),
  @('"#00d4ff"', '"#c084fc"'),
  @('"#0055ff"', '"#9333ea"')
)

foreach ($file in $files) {
  if (!(Test-Path $file)) { Write-Host "SKIP: $file"; continue }
  $content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
  $original = $content
  foreach ($r in $replacements) {
    $content = $content.Replace($r[0], $r[1])
  }
  if ($content -ne $original) {
    [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
    Write-Host "Updated: $file"
  } else {
    Write-Host "No change: $file"
  }
}
Write-Host "Done."
