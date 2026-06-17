$dir = "C:\Users\jeetb\Desktop\StockMarket"
$files = @(
  "$dir\dashboard.html",
  "$dir\login.html",
  "$dir\register.html",
  "$dir\index.html",
  "$dir\profile.html",
  "$dir\css\effects.css",
  "$dir\404.html"
)

# Order matters — more specific patterns first
$replacements = @(
  # ── CSS custom vars ──────────────────────────────────────────
  @('--cyan:#c084fc',          '--cyan:#00c9a7'),
  @('--cyan2:#9333ea',         '--cyan2:#0891b2'),
  @('--bg:#07030f',            '--bg:#0a0f1e'),
  @('--bg:#020818',            '--bg:#0a0f1e'),
  @('--sidebar:#09041a',       '--sidebar:#080d18'),
  @('--glow:rgba(192,132,252,0.4)', '--glow:rgba(0,201,167,0.4)'),
  @('--border:rgba(168,85,247,0.15)', '--border:rgba(0,201,167,0.15)'),
  @('--border:rgba(168,85,247,0.18)', '--border:rgba(0,201,167,0.18)'),
  @('--border:rgba(168,85,247,0.13)', '--border:rgba(0,201,167,0.13)'),

  # ── Purple secondary accent (#a855f7) → sky blue ──────────────
  @('#a855f7',  '#38bdf8'),

  # ── Hex accent purples → teal ─────────────────────────────────
  @('#c084fc',  '#00c9a7'),
  @('#9333ea',  '#0891b2'),

  # ── rgba purples → teal (most common first) ───────────────────
  @('rgba(168,85,247,',   'rgba(0,201,167,'),
  @('rgba(192,132,252,',  'rgba(0,201,167,'),
  @('rgba(147,51,234,',   'rgba(8,145,178,'),
  @('rgba(109,40,217,',   'rgba(8,145,178,'),
  @('rgba(120,40,220,',   'rgba(0,160,185,'),
  @('rgba(124,58,237,',   'rgba(6,182,212,'),
  @('rgba(90,60,230,',    'rgba(0,145,180,'),
  @('rgba(80,60,220,',    'rgba(0,145,180,'),

  # ── Dark bg hex → deep navy ───────────────────────────────────
  @('#07030f',  '#0a0f1e'),
  @('#09041a',  '#080d18'),
  @('#0e0428',  '#0b1020'),
  @('#0c0418',  '#080d18'),
  @('#0c0420',  '#0a1020'),
  @('#08041a',  '#080d18'),
  @('#0b1020',  '#0b1020'),   # no-op, already correct

  # ── rgba dark bg → navy ───────────────────────────────────────
  @('rgba(7,3,15,',    'rgba(10,15,30,'),
  @('rgba(9,4,26,',    'rgba(8,13,24,'),
  @('rgba(12,4,28,',   'rgba(10,15,30,'),
  @('rgba(10,4,24,',   'rgba(10,15,30,'),
  @('rgba(9,3,22,',    'rgba(8,13,24,'),
  @('rgba(14,4,40,',   'rgba(11,16,32,'),

  # ── meta theme-color ─────────────────────────────────────────
  @('content="#c084fc"', 'content="#00c9a7"')
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
