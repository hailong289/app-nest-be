#!/bin/bash

# Script để chạy tất cả microservices trong development mode

echo "🚀 Starting all microservices..."

# Start Auth service
echo "📡 Starting Auth service on port 3001..."
npm run start:dev:auth &
AUTH_PID=$!

# Wait a bit for auth to start
sleep 3

# Start Chat service  
echo "💬 Starting Chat service on port 3002..."
npm run start:dev:chat &
CHAT_PID=$!

# Wait a bit for chat to start
sleep 3

# Start Notification service
echo "🔔 Starting Notification service on port 3003..."
npm run start:dev:notification &
NOTIFICATION_PID=$!

# Wait a bit for notification to start
sleep 3

# Start Filesystem service
echo "📁 Starting Filesystem service on port 3004..."
npm run start:dev:filesystem &
FILESYSTEM_PID=$!

# Wait a bit for filesystem to start
sleep 3

# Start API Gateway
echo "🌐 Starting API Gateway on port 3000..."
npm run start:dev:gateway &
GATEWAY_PID=$!

echo "✅ All services started!"
echo "📡 Auth service: http://localhost:3001"
echo "💬 Chat service: http://localhost:3002" 
echo "🔔 Notification service: http://localhost:3003"
echo "📁 Filesystem service: http://localhost:3004"
echo "🌐 API Gateway: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Function to cleanup processes on exit
cleanup() {
    echo ""
    echo "🛑 Stopping all services..."
    kill $AUTH_PID $CHAT_PID $NOTIFICATION_PID $FILESYSTEM_PID $GATEWAY_PID 2>/dev/null
    echo "✅ All services stopped"
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for all processes
wait