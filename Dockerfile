FROM python:3.9-slim

WORKDIR /app

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY backend/ ./backend/

# Download template assets at build time (not runtime)
RUN cd backend && python fetch_assets.py

# Start the application (no fetch_assets needed at runtime)
CMD ["sh", "-c", "cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT"]
