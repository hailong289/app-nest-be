#!/bin/bash

# Quick script to start different modes
# Usage: ./start.sh [mode]
# Modes: docker, local, stop

MODE=${1:-docker}

case $MODE in
  docker)
    echo "🐳 Starting all services in Docker..."
    docker-compose up -d
    echo "✅ All services started!"
    echo "📍 API Gateway: http://localhost:5000"
    ;;

  local)
    echo "🏠 Starting only infrastructure in Docker..."
    docker-compose -f docker-compose.local.yml up -d
    echo "✅ Infrastructure started!"
    echo ""
    echo "📋 Now start your services locally:"
    echo "   cd apps/api-gateway && npm run start:dev"
    echo "   cd apps/auth && npm run start:dev"
    echo "   cd apps/chat && npm run start:dev"
    echo "   cd apps/filesystem && npm run start:dev"
    echo ""
    echo "⚠️  Make sure to use .env.local for each service!"
    ;;

  stop)
    echo "🛑 Stopping all services..."
    docker-compose down
    docker-compose -f docker-compose.local.yml down
    echo "✅ All services stopped!"
    ;;

  *)
    echo "❌ Unknown mode: $MODE"
    echo ""
    echo "Usage: ./start.sh [mode]"
    echo ""
    echo "Available modes:"
    echo "  docker  - Start all services in Docker"
    echo "  local   - Start only infrastructure, run services locally"
    echo "  stop    - Stop all Docker services"
    exit 1
    ;;
esac
