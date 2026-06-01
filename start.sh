#!/bin/bash
# China Watch — Launch Script
# Run: bash start.sh

set -e
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        CHINA WATCH  —  Research Platform         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check for API key
if [ -z "$GROQ_API_KEY" ]; then
  echo "⚠  GROQ_API_KEY not set in environment."
  echo "   The app will prompt you to enter it in the browser UI."
  echo "   Or export it now: export GROQ_API_KEY=AIza..."
  echo ""
fi

# Start backend
echo "▶  Starting FastAPI backend on http://localhost:8000"
cd "$ROOT_DIR/backend"
GROQ_API_KEY="$GROQ_API_KEY" venv/bin/python main.py &
BACKEND_PID=$!

# Wait for backend
sleep 2

# Start frontend
echo "▶  Starting React frontend on http://localhost:3000"
cd "$ROOT_DIR/frontend"
npm run dev -- --port 3000 &
FRONTEND_PID=$!

echo ""
echo "✅  China Watch is running!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   API docs: http://localhost:8000/docs"
echo ""
echo "   Press Ctrl+C to stop both servers"
echo ""

# Cleanup on exit
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

wait
