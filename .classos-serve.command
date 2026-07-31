#!/bin/bash
# The server itself, in its own window. ClassOS.app opens this in Terminal so
# there is a visible "off switch" — closing the window stops the classroom.
# (Double-clicking this file directly works too.)
cd "$(dirname "$0")" || exit 1

PY=""
for cand in python3 /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo ""
  echo "  ClassOS needs Python, which this Mac does not have yet."
  echo "  Open Terminal and run:  xcode-select --install"
  echo ""
  read -r -p "  Press Return to close."
  exit 1
fi

echo ""
echo "  =============================================="
echo "    Mr. D's Classroom OS is running."
echo ""
echo "    Leave this window open while you teach."
echo "    Closing it shuts the classroom down."
echo "  =============================================="
echo ""
exec "$PY" -m http.server 8000
