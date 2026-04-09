
# FitWhite - Apply Supabase Migrations via Management API
# Usage: .\scripts\apply-migrations.ps1

$PROJECT_REF = "cdtmufbsexzlgucmlols"
$SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdG11ZmJzZXh6bGd1Y21sb2xzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTcyOTYxMSwiZXhwIjoyMDkxMzA1NjExfQ.rHSYEZsCwnga5A8orBuefuzbStJ_oEQAxio-IV2ArmM"

$headers = @{
    "Authorization" = "Bearer $SERVICE_ROLE_KEY"
    "Content-Type"  = "application/json"
    "apikey"        = $SERVICE_ROLE_KEY
}

function Run-SQL {
    param([string]$label, [string]$sql)
    
    Write-Host "`n▶  Running: $label" -ForegroundColor Cyan
    
    $body = [System.Text.Encoding]::UTF8.GetBytes(
        ($sql | ConvertTo-Json -Compress)
    )
    
    # Use Supabase pg endpoint
    try {
        $response = Invoke-WebRequest `
            -Uri "https://$PROJECT_REF.supabase.co/pg/query" `
            -Method POST `
            -Headers $headers `
            -Body ([System.Text.Encoding]::UTF8.GetBytes('{"query":' + ($sql | ConvertTo-Json) + '}')) `
            -ContentType "application/json" `
            -ErrorAction Stop
        
        Write-Host "  ✅  $label applied successfully" -ForegroundColor Green
        return $true
    }
    catch {
        $errorBody = $_.Exception.Response
        if ($errorBody) {
            $reader = New-Object System.IO.StreamReader($errorBody.GetResponseStream())
            $errorText = $reader.ReadToEnd()
            Write-Host "  ⚠️   $label: $errorText" -ForegroundColor Yellow
        } else {
            Write-Host "  ❌  $label: $($_.Exception.Message)" -ForegroundColor Red
        }
        return $false
    }
}

Write-Host "🚀  FitWhite Migration Runner" -ForegroundColor White
Write-Host "    Project: $PROJECT_REF" -ForegroundColor Gray
Write-Host "════════════════════════════════════════" -ForegroundColor Gray

$schema001 = Get-Content "supabase\migrations\001_schema.sql" -Raw -Encoding UTF8
$schema002 = Get-Content "supabase\migrations\002_rls_policies.sql" -Raw -Encoding UTF8

$r1 = Run-SQL "001_schema.sql" $schema001
$r2 = Run-SQL "002_rls_policies.sql" $schema002

Write-Host "`n════════════════════════════════════════" -ForegroundColor Gray
if ($r1 -and $r2) {
    Write-Host "✅  All migrations applied!" -ForegroundColor Green
} else {
    Write-Host "⚠️   Some migrations may have failed — check output above." -ForegroundColor Yellow
    Write-Host "    If you see 'already exists' errors, the schema was already applied." -ForegroundColor Gray
}
