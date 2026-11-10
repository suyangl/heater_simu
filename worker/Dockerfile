FROM opencfd/openfoam-default:2406
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libxrender1 libxt6 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir pyvista==0.44.2 vtk==9.3.1 pydantic==2.11.4
ENV PATH="/opt/venv/bin:${PATH}" PYTHONPATH=/app OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
WORKDIR /app
COPY api/app app
COPY worker/runner.py runner.py
COPY worker/visualization.py visualization.py
COPY trainer trainer
ENTRYPOINT ["/bin/bash", "-c", "source /usr/lib/openfoam/openfoam2406/etc/bashrc && exec python /app/runner.py"]
