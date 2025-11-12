#!/bin/bash

# Local Development Script
# This script starts both backend and frontend for local development

echo "🚀 Starting PPT Generator Locally..."
echo ""

# Check if backend venv exists
if [ ! -d "backend/venv" ]; then
    echo "📦 Creating backend virtual environment..."
    cd backend
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    echo "📥 Fetching assets..."
    python fetch_assets.py
    cd ..
else
    echo "✓ Backend virtual environment exists"
fi

# Start backend in background
echo ""
echo "🔧 Starting backend on http://localhost:8000..."
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 3

# Start frontend
echo ""
echo "🎨 Starting frontend on http://localhost:5173..."
cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

# Set local API URL
export VITE_API_URL=http://localhost:8000

# Start frontend
npm run dev &
FRONTEND_PID=$!

cd ..

echo ""
echo "✅ Both servers are running!"
echo ""
echo "📍 Backend:  http://localhost:8000"
echo "📍 Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user interrupt
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait

