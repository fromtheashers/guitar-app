#!/bin/sh
# Downloads the standalone yt-dlp binary into ./bin for the YouTube audio route.
# Runs on every Render build so YouTube changes are picked up with each deploy.
set -e
mkdir -p bin
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o bin/yt-dlp
chmod +x bin/yt-dlp
./bin/yt-dlp --version
