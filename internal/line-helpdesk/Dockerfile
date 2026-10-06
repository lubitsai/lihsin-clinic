FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY . .
RUN useradd --system --no-create-home app
USER app
ENV PORT=8080
CMD ["sh", "-c", "exec functions-framework --target=linebot --host=0.0.0.0 --port=${PORT}"]
