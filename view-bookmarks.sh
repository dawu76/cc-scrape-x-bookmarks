#!/bin/bash
# Start local web server and open bookmark viewer

echo "🚀 Starting local web server on port 8080..."
python3 -m http.server 8080 > /dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 1

echo "📊 Opening bookmark viewer in your browser..."
open http://localhost:8080/bookmark-viewer.html

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
