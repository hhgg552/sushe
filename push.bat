cd /d "D:\桌面\宿舍"
set "GIT_SSH_COMMAND=ssh -i %USERPROFILE%\.ssh\id_ed25519 -o StrictHostKeyChecking=accept-new"
git push -u origin master
