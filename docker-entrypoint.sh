#!/bin/sh
# Starts a virtual display so the real (non-headless) Chrome render.js needs
# has somewhere to draw — see src/portal/render.js for why headless doesn't
# work against this specific site. Xvfb just fakes a monitor; nothing here
# is about hiding automation.
set -e

Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99

# Give Xvfb a moment to actually be ready before Chrome tries to use it.
sleep 1

exec node src/index.js
