#!/usr/bin/env bash
# TaskPilot AI - Google Cloud Run Deployment Script
# Utilizes GCP Billing Credits (Billing Account: 524914727)

set -e

PROJECT_ID="${GCP_PROJECT_ID:-waskpilotai}"
REGION="${VERTEX_AI_LOCATION:-us-central1}"
SERVICE_NAME="taskpilotai-backend"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "${SCRIPT_DIR}"

echo "TaskPilot AI - Deploying to Google Cloud Run"
echo "Project ID: ${PROJECT_ID}"
echo "Region:     ${REGION}"
echo "Image:      ${IMAGE_NAME}"

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
    echo "gcloud CLI is not installed. Please install the Google Cloud SDK:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

echo "1. Building container image via Google Cloud Build..."
gcloud builds submit --project="${PROJECT_ID}" --tag="${IMAGE_NAME}" .

echo "2. Deploying container to Google Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${IMAGE_NAME}" \
    --platform=managed \
    --allow-unauthenticated \
    --port=8787 \
    --min-instances=0 \
    --max-instances=10 \
    --memory=512Mi \
    --cpu=1 \
    --set-env-vars="NODE_ENV=production,LLM_PROVIDER=gemini,LLM_MODEL=gemini-2.5-flash"

echo "Deployment successful! Service URL:"
gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format="value(status.url)"
