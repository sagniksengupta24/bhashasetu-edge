FROM python:3.12-slim

WORKDIR /app

RUN groupadd -r appgroup && useradd -r -g appgroup appuser \
    && mkdir -p /data && chown -R appuser:appgroup /data

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py test_main.py ./
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
