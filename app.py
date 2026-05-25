"""
501宿舍纪念网页 - Flask 后端
启动方式: python app.py
访问地址: http://localhost:5000
"""
import os
import uuid
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 单文件最大 16MB

# 项目根目录 = app.py 所在目录
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(ROOT_DIR, 'images')

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
    print('  按 Ctrl+C 停止服务器')
    print('=' * 50)
    app.run(host='0.0.0.0', port=5000, debug=True)
