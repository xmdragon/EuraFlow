#!/bin/bash

# Kill any existing backend processes on port 8000
echo "Stopping existing backend servers..."
lsof -ti:8000 | xargs -r kill -9 2>/dev/null || true
pkill -f "uvicorn ef_core" 2>/dev/null || true

# Wait a moment for ports to be freed
sleep 1

# Activate virtual environment and start the backend server
echo "Starting backend server on port 8000..."
cd /home/grom/EuraFlow
source ~/.venvs/euraflow/bin/activate
uvicorn ef_core.app:app --reload --port 8000