@echo off
chcp 65001 >nul
echo ========================================
echo      部署绩点排行榜到 Render
echo ========================================
echo.

REM 复制最新的绩点表到 data 目录
echo 📁 复制桌面绩点表到项目目录...
copy "C:\Users\嗷呜\Desktop\绩点表.csv" "%~dp0data\gpa.csv" /Y
if %errorlevel% neq 0 (
    echo ❌ 复制失败！
    pause
    exit /b 1
)
echo ✅ 已复制最新数据
echo.

REM 检查 git 是否初始化
echo 📦 检查 Git 仓库...
cd /d "%~dp0"

if not exist ".git" (
    echo 🆕 初始化 Git 仓库...
    git init
    git remote add origin https://github.com/yourusername/gpa-tracker.git
)

echo.
echo 📤 提交更改到 Git...
git add .
git commit -m "更新绩点数据 - %date% %time%"

echo.
echo 🚀 推送到 Render...
git push origin main

echo.
echo ========================================
echo ✅ 部署完成！
echo ========================================
echo.
echo 请等待 Render 自动部署（约 1-2 分钟）
echo 部署完成后访问: https://gpa-tracker-7jsx.onrender.com/
echo.
pause
