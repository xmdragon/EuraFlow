#!/bin/bash

# Kill any existing vite/node processes on port 3000
echo "Stopping existing dev servers..."
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
lsof -ti:3001 | xargs -r kill -9 2>/dev/null || true  
lsof -ti:3002 | xargs -r kill -9 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

# Wait a moment for ports to be freed
sleep 1

# Start the dev server
echo "Starting dev server on port 3000..."
npm run dev