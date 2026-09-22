FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first (smaller than default which includes CUDA)
RUN pip install --no-cache-dir \
    torch==2.3.1+cpu \
    torchaudio==2.3.1+cpu \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Download audeering gender model at build time (not in git — too large for GitHub)
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download(\
    repo_id='audeering/wav2vec2-large-robust-6-ft-age-gender', \
    cache_dir='pretrained_models/audeering-gender'\
); \
print('audeering gender model ready')"

# Pre-download ECAPA-TDNN model (baked into image, no cold-start network hit)
RUN python -c "\
from speechbrain.inference.speaker import EncoderClassifier; \
EncoderClassifier.from_hparams(\
    source='speechbrain/spkrec-ecapa-voxceleb', \
    savedir='pretrained_models/spkrec-ecapa-voxceleb', \
    run_opts={'device': 'cpu'}\
); \
print('ECAPA-TDNN model ready')"

RUN mkdir -p /data/bioprints /data/baselines

ENV BIOPRINTS_DIR=/data/bioprints
ENV BASELINES_DIR=/data/baselines

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
