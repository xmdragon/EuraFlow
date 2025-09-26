#!/bin/bash

echo "========================================="
echo "Stopping EuraFlow Development Environment"
echo "========================================="

# Function to kill processes on a port
kill_port() {
    local port=$1
    local name=$2
    echo "Stopping $name on port $port..."
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
        echo "$pids" | xargs -r kill -9 2>/dev/null
        echo "✓ $name stopped"
    else
        echo "  $name was not running"
    fi
}

# Stop backend server
echo ""
echo "Stopping backend services..."
kill_port 8000 "Backend server"
pkill -f "uvicorn ef_core" 2>/dev/null || true

# Stop watermark task runner
echo "Stopping Watermark task runner..."
pkill -f "watermark_task_runner" 2>/dev/null || true
echo "✓ Watermark task runner stopped"

# Stop competitor task runner
echo "Stopping Competitor task runner..."
pkill -f "competitor_task_runner" 2>/dev/null || true
echo "✓ Competitor task runner stopped"

# Stop frontend server
echo ""
echo "Stopping frontend services..."
kill_port 3000 "Frontend server (port 3000)"
kill_port 3001 "Frontend server (port 3001)"
kill_port 3002 "Frontend server (port 3002)"
pkill -f "vite" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

# Clean up any node processes
echo ""
echo "Cleaning up remaining processes..."
pkill -f "node.*vite" 2>/dev/null || true

echo ""
echo "========================================="
echo "All services stopped successfully!"
echo "========================================="