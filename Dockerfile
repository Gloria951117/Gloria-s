FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV VOC_HOST=0.0.0.0
ENV VOC_DATA_DIR=/var/data/data
ENV VOC_EXPORT_DIR=/var/data/exports
EXPOSE 8787

CMD ["python", "server.py"]
