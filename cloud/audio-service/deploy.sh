#!/bin/bash
# Switches on (or updates) the audio service on Google Cloud Run. Run it in Cloud
# Shell:  bash guitar-app/cloud/audio-service/deploy.sh <project id>
# It prints the two values to add to Vercel. Re-running it keeps the same password.
set -euo pipefail
PROJECT="${1:?Give the project ID, e.g. bash deploy.sh guitar-app-123456}"
REGION=us-central1
SERVICE=chord-audio
HERE="$(cd "$(dirname "$0")" && pwd)"

gcloud config set project "$PROJECT" --quiet
echo "Switching on the Google Cloud services this needs (takes a minute the first time)…"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com compute.googleapis.com --quiet

# New projects build with the default compute account. It only appears a little
# after the Compute API is switched on, and it needs permission to build.
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
BUILDER="${NUMBER}-compute@developer.gserviceaccount.com"
for i in $(seq 1 24); do
  gcloud iam service-accounts describe "$BUILDER" --quiet >/dev/null 2>&1 && break
  [ "$i" = 1 ] && echo "Waiting for Google Cloud to create its build account…"
  sleep 5
done
gcloud iam service-accounts enable "$BUILDER" --quiet >/dev/null 2>&1 || true
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${BUILDER}" \
  --role=roles/run.builder --condition=None --quiet >/dev/null

TOKEN="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json 2>/dev/null \
  | python3 -c 'import json,sys; e=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env",[]); print(next((v["value"] for v in e if v["name"]=="AUDIO_TOKEN"),""))' 2>/dev/null || true)"
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 24)"

deploy() {
  gcloud run deploy "$SERVICE" --source "$HERE" --region "$REGION" \
    --allow-unauthenticated --max-instances 2 --memory 512Mi --cpu 1 --timeout 120 \
    --set-env-vars "AUDIO_TOKEN=$TOKEN" --quiet
}
echo "Building and starting the audio service (about 3 minutes)…"
if ! deploy; then
  # New permissions can take a minute or two to reach Cloud Build.
  echo "The first try didn't go through; Google Cloud may still be setting up permissions. Trying again in 90 seconds…"
  sleep 90
  if ! deploy; then
    echo
    echo "It still didn't work. Copy the red lines above (from 'ERROR') and send them to Claude."
    exit 1
  fi
fi

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Checking YouTube lets the service in…"
curl -s -H "Authorization: Bearer $TOKEN" "$URL/check?v=V39qPqyyB2A" || true
echo
echo "Add these two in Vercel (guitar-app → Settings → Environment Variables), then redeploy:"
echo "  AUDIO_SERVICE_URL   = $URL"
echo "  AUDIO_SERVICE_TOKEN = $TOKEN"
