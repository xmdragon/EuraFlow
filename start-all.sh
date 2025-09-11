#!/bin/bash

echo "========================================="
echo "Starting EuraFlow Development Environment"
echo "========================================="

# Function to kill processes on a port
kill_port() {
    local port=$1
    echo "Cleaning port $port..."
    lsof -ti:$port | xargs -r kill -9 2>/dev/null || true
}

# Clean up existing processes
echo ""
echo "Step 1: Cleaning up existing processes..."
kill_port 8000
kill_port 3000
kill_port 3001
kill_port 3002
pkill -f "uvicorn ef_core" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

# Wait for ports to be freed
sleep 2

# Start backend server
echo ""
echo "Step 2: Starting backend server..."
cd /home/grom/EuraFlow
source ~/.venvs/euraflow/bin/activate
nohup uvicorn ef_core.app:app --reload --port 8000 > backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend server starting with PID $BACKEND_PID (logs in backend.log)"

# Wait for backend to be ready
echo "Waiting for backend to be ready..."
for i in {1..10}; do
    if curl -s http://localhost:8000/api/ef/v1/system/health > /dev/null 2>&1; then
        echo "✓ Backend is ready!"
        break
    fi
    echo -n "."
    sleep 1
done

# Start frontend server
echo ""
echo "Step 3: Starting frontend server..."
cd /home/grom/EuraFlow/web
nohup npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend server starting with PID $FRONTEND_PID (logs in frontend.log)"

# Wait for frontend to be ready
echo "Waiting for frontend to be ready..."
for i in {1..10}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "✓ Frontend is ready!"
        break
    fi
    echo -n "."
    sleep 1
done

# Summary
echo ""
echo "========================================="
echo "EuraFlow Development Environment Started!"
echo "========================================="
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Process IDs:"
echo "  Backend:  $BACKEND_PID"
echo "  Frontend: $FRONTEND_PID"
echo ""
echo "Log files:"
echo "  Backend:  /home/grom/EuraFlow/backend.log"
echo "  Frontend: /home/grom/EuraFlow/frontend.log"
echo ""
echo "To stop all services, run: ./stop-all.sh"
echo "========================================="