# Quick script to start different modes
# Usage: .\start.ps1 [mode]
# Modes: docker, local, stop

param(
    [string]$Mode = "docker"
)

switch ($Mode) {
    "docker" {
        Write-Host "🐳 Starting all services in Docker..." -ForegroundColor Cyan
        docker-compose up -d
        Write-Host "✅ All services started!" -ForegroundColor Green
        Write-Host "📍 API Gateway: http://localhost:5000" -ForegroundColor Yellow
    }

    "local" {
        Write-Host "🏠 Starting only infrastructure in Docker..." -ForegroundColor Cyan
        docker-compose -f docker-compose.local.yml up -d
        Write-Host "✅ Infrastructure started!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📋 Now start your services locally:" -ForegroundColor Yellow
        Write-Host "   cd apps/api-gateway; npm run start:dev"
        Write-Host "   cd apps/auth; npm run start:dev"
        Write-Host "   cd apps/chat; npm run start:dev"
        Write-Host "   cd apps/filesystem; npm run start:dev"
        Write-Host ""
        Write-Host "⚠️  Make sure to use .env.local for each service!" -ForegroundColor Red
    }

    "stop" {
        Write-Host "🛑 Stopping all services..." -ForegroundColor Cyan
        docker-compose down
        docker-compose -f docker-compose.local.yml down
        Write-Host "✅ All services stopped!" -ForegroundColor Green
    }

    default {
        Write-Host "❌ Unknown mode: $Mode" -ForegroundColor Red
        Write-Host ""
        Write-Host "Usage: .\start.ps1 [mode]" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Available modes:" -ForegroundColor Yellow
        Write-Host "  docker  - Start all services in Docker"
        Write-Host "  local   - Start only infrastructure, run services locally"
        Write-Host "  stop    - Stop all Docker services"
        exit 1
    }
}
