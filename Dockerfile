FROM python:3.9-slim

WORKDIR /app

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY backend/ ./backend/

# At build time (not at runtime): download the template decks, cut them into one small deck
# per hotel / restaurant / activity, then drop the huge originals. The server then only opens
# small files, which keeps memory and response time low.
RUN cd backend && STRICT_ASSETS=1 python fetch_assets.py && python build_slices.py \
    && rm -f liste_HOTELS.pptx liste_REPAS.pptx liste_ACTIVITES.pptx

# Start the application (no fetch_assets needed at runtime)
CMD ["sh", "-c", "cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT"]
