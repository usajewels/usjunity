# ===========================================================
# MXSuite — Local Deployment Script (PowerShell)
# ===========================================================
# Usage:
#   .\deploy.ps1              Build and start (dev mode)
#   .\deploy.ps1 -Prod        Build and start (production)
#   .\deploy.ps1 -Down        Stop all services
#   .\deploy.ps1 -Rebuild     Force rebuild images
#   .\deploy.ps1 -Logs        Tail logs
#   .\deploy.ps1 -Status      Show service status
#   .\deploy.ps1 -Reset       Stop, remove volumes, rebuild
# ===========================================================

param(
    [switch]$Down,
    [switch]$Rebuild,
    [switch]$Logs,
    [switch]$Status,
    [switch]$Reset,
    [switch]$Prod
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Dev mode by default; -Prod for production-only compose
$ComposeFiles = if ($Prod) {
    @("-f", "docker-compose.yml")
} else {
    @("-f", "docker-compose.yml", "-f", "docker-compose.dev.yml")
}
$ComposeCmd = "docker compose $($ComposeFiles -join ' ')"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  MXSuite Deployment Script" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ─── Check Docker is running ──────────────────────────────
function Test-Docker {
    try {
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw }
    } catch {
        Write-Host "ERROR: Docker is not running. Start Docker Desktop first." -ForegroundColor Red
        exit 1
    }
}

# ─── Check .env exists ────────────────────────────────────
function Test-EnvFile {
    $envFile = Join-Path $ProjectRoot ".env"
    if (-not (Test-Path $envFile)) {
        Write-Host "No .env file found. Creating from .env.example..." -ForegroundColor Yellow
        Copy-Item (Join-Path $ProjectRoot ".env.example") $envFile
        Write-Host "Created .env — please review and edit D:\growthzone\.env" -ForegroundColor Yellow
        Write-Host ""
    }
}

# ─── Stop services ─────────────────────────────────────────
if ($Down) {
    Test-Docker
    Write-Host "Stopping MXSuite services..." -ForegroundColor Yellow
    Set-Location $ProjectRoot
    Invoke-Expression "$ComposeCmd down"
    Write-Host "All services stopped." -ForegroundColor Green
    exit 0
}

# ─── Show logs ─────────────────────────────────────────────
if ($Logs) {
    Test-Docker
    Set-Location $ProjectRoot
    Invoke-Expression "$ComposeCmd logs -f --tail=100"
    exit 0
}

# ─── Show status ───────────────────────────────────────────
if ($Status) {
    Test-Docker
    Set-Location $ProjectRoot
    Write-Host "Service Status:" -ForegroundColor Cyan
    Invoke-Expression "$ComposeCmd ps"
    Write-Host ""
    Write-Host "Container Resource Usage:" -ForegroundColor Cyan
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    exit 0
}

# ─── Reset (nuclear option) ───────────────────────────────
if ($Reset) {
    Test-Docker
    Write-Host "WARNING: This will DELETE all data (database, files, etc.)!" -ForegroundColor Red
    $confirm = Read-Host "Type YES to confirm"
    if ($confirm -ne "YES") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
    Set-Location $ProjectRoot
    Invoke-Expression "$ComposeCmd down -v"
    Write-Host "Volumes removed. Rebuilding..." -ForegroundColor Yellow
    Invoke-Expression "$ComposeCmd up -d --build"
    Write-Host "Reset complete." -ForegroundColor Green
    exit 0
}

# ─── Build and deploy ─────────────────────────────────────
Test-Docker
Test-EnvFile

Set-Location $ProjectRoot

# Step 1: Build Docker images
Write-Host "[1/3] Building Docker images..." -ForegroundColor Cyan
Write-Host "  This may take 5-10 minutes on first run." -ForegroundColor Gray

$buildArgs = @("docker-compose", "build")
if ($Rebuild) { $buildArgs += "--no-cache" }

$buildCmd = if ($Rebuild) { "$ComposeCmd build --no-cache" } else { "$ComposeCmd build" }
Invoke-Expression $buildCmd

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker build failed. Check output above." -ForegroundColor Red
    exit 1
}
Write-Host "  Docker images built successfully." -ForegroundColor Green

# Step 2: Start services
$mode = if ($Prod) { "production" } else { "development" }
Write-Host "[2/3] Starting services ($mode mode)..." -ForegroundColor Cyan
Invoke-Expression "$ComposeCmd up -d"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start services." -ForegroundColor Red
    exit 1
}

# Step 3: Wait for health checks
Write-Host "[3/3] Waiting for services to become healthy..." -ForegroundColor Cyan

$maxWait = 120
$elapsed = 0
$allHealthy = $false

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 5
    $elapsed += 5

    $apiHealth = docker inspect --format='{{.State.Health.Status}}' mxsuite-api 2>$null
    $pgHealth = docker inspect --format='{{.State.Health.Status}}' mxsuite-postgres 2>$null
    $redisHealth = docker inspect --format='{{.State.Health.Status}}' mxsuite-redis 2>$null
    $feHealth = docker inspect --format='{{.State.Health.Status}}' mxsuite-frontend 2>$null

    Write-Host "  [$elapsed`s] postgres=$pgHealth redis=$redisHealth api=$apiHealth frontend=$feHealth" -ForegroundColor Gray

    if ($apiHealth -eq "healthy" -and $pgHealth -eq "healthy" -and $redisHealth -eq "healthy" -and $feHealth -eq "healthy") {
        $allHealthy = $true
        break
    }
}

Write-Host ""
if ($allHealthy) {
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  MXSuite is RUNNING!" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Application:  http://localhost" -ForegroundColor White
    Write-Host "  API:          http://localhost/api/" -ForegroundColor White
    Write-Host "  Swagger UI:   http://localhost/swagger-ui/index.html" -ForegroundColor White
    if (-not $Prod) {
        Write-Host "  MailHog:      http://localhost:8025" -ForegroundColor White
        Write-Host "  Debug Port:   localhost:5005 (remote JVM debug)" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "  Default Login:" -ForegroundColor Yellow
    Write-Host "    Email:    admin@mxsuite.com" -ForegroundColor White
    Write-Host "    Password: (from .env MXSUITE_ADMIN_PASSWORD)" -ForegroundColor White
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor Cyan
    Write-Host "    .\deploy.ps1 -Logs     View logs" -ForegroundColor Gray
    Write-Host "    .\deploy.ps1 -Status   Service status" -ForegroundColor Gray
    Write-Host "    .\deploy.ps1 -Down     Stop services" -ForegroundColor Gray
    Write-Host "    .\deploy.ps1 -Reset    Reset everything" -ForegroundColor Gray
} else {
    Write-Host "WARNING: Some services may not be healthy yet." -ForegroundColor Yellow
    Write-Host "Run '.\deploy.ps1 -Logs' to check for errors." -ForegroundColor Yellow
    Invoke-Expression "$ComposeCmd ps"
}
