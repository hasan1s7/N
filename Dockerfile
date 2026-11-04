FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NABU_HOST=0.0.0.0 PORT=8000 NABU_DB=/data/nabu.sqlite3
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home nabu && mkdir -p /data && chown nabu:nabu /data
COPY --chown=nabu:nabu server.py ./
COPY --chown=nabu:nabu public ./public
USER nabu
VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "server.py"]
