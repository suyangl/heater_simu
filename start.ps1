$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "请先启动 Docker Desktop，并启用 WSL2 后端。"
    exit 1
}
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "Docker 构建或启动失败" }
Start-Process "http://localhost:8080"
