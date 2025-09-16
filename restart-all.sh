#!/bin/bash

echo "========================================="
echo "Restarting EuraFlow Development Environment"
echo "========================================="

# Stop all services first
echo "Step 1: Stopping all services..."
./stop-all.sh

# Wait a moment for cleanup
echo ""
echo "Waiting for cleanup to complete..."
sleep 3

# Start all services
echo ""
echo "Step 2: Starting all services..."
./start-all.sh

echo ""
echo "========================================="
echo "EuraFlow Development Environment Restarted!"
echo "========================================="