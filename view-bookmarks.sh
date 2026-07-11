#!/bin/bash
# Start local web server and open bookmark viewer

if lsof -i :8080 >/dev/null 2>&1; then
  echo "❌ Port 8080 is already in use. Stop the other process first (lsof -i :8080)."
  exit 1
fi

echo "🚀 Starting local web server on port 8080..."
python3 -m http.server 8080 > /dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 1

echo "📊 Opening bookmark viewer in your browser..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  xdg-open http://localhost:8080/bookmark-viewer.html
elif [[ "$OSTYPE" == "darwin"* ]]; then
  open http://localhost:8080/bookmark-viewer.html
else
  echo "⚠️  Could not detect OS. Please open http://localhost:8080/bookmark-viewer.html manually."
fi

echo ""
echo "✅ Bookmark viewer is now running!"
echo "📍 URL: http://localhost:8080/bookmark-viewer.html"
echo ""
echo "To stop the server, press Ctrl+C or run:"
echo "   kill $SERVER_PID"
echo ""

# Keep script running so Ctrl+C can stop the server
trap "kill $SERVER_PID 2>/dev/null; echo '🛑 Server stopped.'; exit" INT TERM
wait $SERVER_PID
