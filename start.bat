@echo off
echo 啟動本機伺服器...
echo 請稍候，瀏覽器將自動開啟 http://localhost:8080
timeout /t 1 /nobreak >nul
start http://localhost:8080
python -m http.server 8080
