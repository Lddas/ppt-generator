FROM python:3.9-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY backend/ ./backend/

# At build time (not at runtime): download the templates bundle (small per-hotel / restaurant /
# activity decks made by build_slices.py + make_bundle.py) and unpack it. The server never opens
# the huge original decks, which keeps memory and response time low.
RUN cd backend && STRICT_ASSETS=1 python fetch_assets.py

# Start the application (no fetch_assets needed at runtime)
# Cloud Run and Render both give the port in $PORT (8080 if it is missing)
CMD ["sh", "-c", "cd backend && exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
