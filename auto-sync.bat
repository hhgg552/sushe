@echo off
cd /d "%~dp0"
echo 检查是否有变更...
git add -A
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo 无变更，跳过提交
    exit /b 0
)
git commit -m "自动同步更新 %date% %time%"
echo 推送到 GitHub...
git push
echo 同步完成！
pause
