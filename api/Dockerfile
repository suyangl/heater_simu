FROM python:3.11-slim
WORKDIR /app
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/app app
COPY api/tests tests
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
