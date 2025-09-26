#!/bin/bash

echo "Starting Auth gRPC Service..."

# Kill any existing auth service
pkill -f "nest start auth"

# Build auth service
npm run build:auth

# Start auth service
npm run start:dev:auth &

# Wait for service to start
sleep 5

echo "Auth gRPC Service started on port 50051"
echo "You can now start the API Gateway"