"""
501宿舍纪念网页 - Flask 后端
启动方式: python app.py
访问地址: http://localhost:5000

自动同步功能:
  上传图片保存后，自动执行 git add / commit / push 推送到 GitHub
  如需关闭自动同步，将下方 GIT_AUTO_SYNC 改为 False
"""
import os
import uuid
import subprocess
import threading
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 单文件最大 16MB

# 项目根目录 = app.py 所在目录
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(ROOT_DIR, 'images')

# ---------- Git 自动同步开关 ----------
# 设为 False 可关闭自动同步（仅本地保存，不推送 GitHub）
GIT_AUTO_SYNC = True

# 允许的图片/视频格式
PHOTO_EXTS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
VIDEO_EXTS = {'mp4', 'webm', 'mov', 'avi'}


def is_allowed(filename):
    """检查是否为允许的媒体格式"""
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in PHOTO_EXTS or ext in VIDEO_EXTS


def make_safe_name(original):
    """生成安全的文件名，避免中文/特殊字符问题"""
    ext = original.rsplit('.', 1)[1].lower() if '.' in original else 'jpg'
    return f"upload_{uuid.uuid4().hex[:8]}.{ext}"


# ==================== Git 自动同步 ====================

def _run_git(args, timeout=30):
    """在项目根目录执行 git 命令，返回 (success, output)"""
    try:
        result = subprocess.run(
            ['git'] + args,
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0:
            return True, result.stdout.strip() or result.stderr.strip()
        else:
            return False, result.stderr.strip() or result.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, 'Git 命令超时（网络可能较慢）'
    except FileNotFoundError:
        return False, '未找到 Git，请确认已安装 Git 并添加到系统 PATH'
    except Exception as e:
        return False, f'Git 命令异常: {e}'


def check_git_config():
    """启动时检查 Git 配置是否就绪"""
    issues = []

    ok, _ = _run_git(['rev-parse', '--is-inside-work-tree'])
    if not ok:
        issues.append('当前目录不是 Git 仓库')

    ok, name = _run_git(['config', 'user.name'])
    if not ok or not name:
        issues.append('Git user.name 未配置')

    ok, email = _run_git(['config', 'user.email'])
    if not ok or not email:
        issues.append('Git user.email 未配置')

    return issues


def git_sync(filename):
    """在后台线程中执行 git add → commit → push"""
    def _sync():
        short_name = os.path.basename(filename)

        # 第一步：git add
        ok, msg = _run_git(['add', filename])
        if not ok:
            print(f'  [Git] add 失败: {msg}')
            return
        print(f'  [Git] add {short_name} ✓')

        # 第二步：git commit
        commit_msg = f'更新宿舍相册：新增图片 {short_name}'
        ok, msg = _run_git(['commit', '-m', commit_msg])
        if not ok:
            if 'nothing to commit' in msg or 'nothing added' in msg:
                print(f'  [Git] 没有需要提交的变更')
            else:
                print(f'  [Git] commit 失败: {msg}')
            return
        print(f'  [Git] commit ✓')

        # 第三步：git push
        ok, msg = _run_git(['push'], timeout=60)
        if not ok:
            print(f'  [Git] push 失败: {msg}')
            print(f'  [Git] 请检查网络连接，稍后可手动执行 git push')
            return
        print(f'  [Git] push ✓ → GitHub Pages 约 1 分钟后更新')

    thread = threading.Thread(target=_sync, daemon=True)
    thread.start()


# ==================== 页面路由 ====================

@app.route('/')
def index():
    """主页"""
    return send_from_directory(ROOT_DIR, 'index.html')


@app.route('/<path:filename>')
def static_files(filename):
    """静态文件（图片、音乐、CSS、JS 等）"""
    return send_from_directory(ROOT_DIR, filename)


# ==================== API 接口 ====================

@app.route('/api/images')
def list_images():
    """返回 images 文件夹中的相册媒体文件（排除成员照片等）"""
    items = []
    if not os.path.exists(UPLOAD_DIR):
        return jsonify(items)

    for name in sorted(os.listdir(UPLOAD_DIR)):
        if name.startswith('.'):
            continue
        # 只返回相册相关文件：gallery* / upload_* / gallery-video*
        if not (name.startswith('gallery') or name.startswith('upload_')):
            continue
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        if ext in PHOTO_EXTS:
            items.append({'url': f'images/{name}', 'type': 'photo'})
        elif ext in VIDEO_EXTS:
            items.append({'url': f'images/{name}', 'type': 'video'})

    return jsonify(items)


@app.route('/upload', methods=['POST'])
def upload():
    """接收上传的图片/视频，保存到 images 文件夹"""
    if 'file' not in request.files:
        return jsonify({'error': '没有选择文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '文件名为空'}), 400

    if not is_allowed(file.filename):
        return jsonify({'error': '不支持的文件格式，请上传 jpg/png/gif/webp/mp4 等'}), 400

    filename = make_safe_name(file.filename)
    save_path = os.path.join(UPLOAD_DIR, filename)

    # 确保 images 目录存在
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    file.save(save_path)

    # 判断类型
    ext = filename.rsplit('.', 1)[1].lower()
    file_type = 'video' if ext in VIDEO_EXTS else 'photo'

    # 自动同步到 GitHub（后台线程，不阻塞响应）
    if GIT_AUTO_SYNC:
        git_sync(save_path)

    return jsonify({
        'url': f'images/{filename}',
        'type': file_type,
        'name': filename,
    })


# ==================== 启动 ====================

if __name__ == '__main__':
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    print('=' * 50)
    print('  501宿舍纪念网页 已启动')
    print(f'  访问地址: http://localhost:5000')
    print(f'  图片目录: {UPLOAD_DIR}')
    print('-' * 50)

    # Git 配置检查
    if GIT_AUTO_SYNC:
        print('  检查 Git 配置...')
        issues = check_git_config()
        if issues:
            print('  [警告] Git 配置存在问题，自动同步可能失败：')
            for issue in issues:
                print(f'    - {issue}')
            print('  解决方法：')
            print('    git config --global user.name "你的名字"')
            print('    git config --global user.email "你的邮箱"')
        else:
            print('  [Git] 配置检查通过，上传图片将自动推送到 GitHub')
    else:
        print('  [Git] 自动同步已关闭（GIT_AUTO_SYNC = False）')

    print('  按 Ctrl+C 停止服务器')
    print('=' * 50)

    app.run(host='0.0.0.0', port=5000, debug=True)
