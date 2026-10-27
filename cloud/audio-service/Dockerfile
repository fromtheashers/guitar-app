# Chord Window audio service (Google Cloud Run). See README.md.
FROM node:22-slim
# yt-dlp changes often to keep up with YouTube; each deploy fetches the latest.
# (Plain ADD + chmod: Cloud Build's default builder doesn't support ADD --chmod.)
ADD https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp
WORKDIR /app
COPY server.mjs .
USER node
CMD ["node", "server.mjs"]
