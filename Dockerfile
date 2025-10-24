FROM python:3.9-slim

WORKDIR /app/backend

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create a simple startup script
RUN echo 'python fetch_assets.py' > /tmp/fetch.sh && \
    echo 'uvicorn main:app --host 0.0.0.0 --port $PORT' >> /tmp/fetch.sh && \
    chmod +x /tmp/fetch.sh

# Start the application
CMD ["/bin/bash", "/tmp/fetch.sh"]
