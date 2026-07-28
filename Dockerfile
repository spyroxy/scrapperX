# Gunakan base image resmi dari Playwright yang sudah terpasang Python dan browser
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set direktori kerja di dalam container
WORKDIR /app

# Salin file requirements.txt
COPY requirements.txt .

# Instal dependensi Python
RUN pip install --no-cache-dir -r requirements.txt

# Salin semua file proyek ke dalam container
COPY . .

# Ekspos port (Back4app biasanya menggunakan environment variable PORT)
EXPOSE 8080

# Jalankan server FastAPI
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
