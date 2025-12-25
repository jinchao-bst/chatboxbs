#!/usr/bin/env python3
"""
替换所有 Chatbox 图标为 BlueStacks 图标

使用方法:
    python scripts/replace-all-icons.py [source_icon_path]

如果未提供路径，将使用 ap-ai-agent/agent/BlueStacks.ico
"""

import os
import sys
import shutil
from pathlib import Path
from PIL import Image
import subprocess

# 项目根目录
ROOT = Path(__file__).resolve().parent.parent

# 源图标路径
DEFAULT_SOURCE = ROOT / "ap-ai-agent" / "agent" / "BlueStacks.ico"

# 目标目录
ASSETS_DIR = ROOT / "assets"
ICONS_DIR = ASSETS_DIR / "icons"
RENDERER_DIR = ROOT / "src" / "renderer"

# 需要替换的图标文件列表
ICON_FILES_TO_REPLACE = [
    "icon.png",
    "icon-1024.png",
    "icon_pro.png",
    "icon_pro2.png",
    "icon_pro_plus.png",
    "icon-raw.png",
]


def load_source_image(image_path: Path) -> Image.Image:
    """加载源图像文件（支持多种格式）"""
    try:
        with Image.open(image_path) as img:
            # 如果是 ICO 文件，尝试提取最大尺寸
            if image_path.suffix.lower() == '.ico':
                images = {}
                if hasattr(img, 'n_frames'):
                    for i in range(img.n_frames):
                        img.seek(i)
                        size = img.size[0]  # 假设是正方形
                        images[size] = img.copy()
                else:
                    size = img.size[0]
                    images[size] = img.copy()
                
                if images:
                    # 选择最大的图像
                    max_size = max(images.keys())
                    return images[max_size]
            
            # 其他格式直接打开
            # 转换为 RGBA 以支持透明背景
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            
            return img.copy()
    except Exception as e:
        print(f"[错误] 无法打开图像文件: {e}")
        print(f"   文件路径: {image_path}")
        raise


def resize_image(img: Image.Image, size: int) -> Image.Image:
    """调整图像大小，使用高质量重采样"""
    return img.resize((size, size), Image.Resampling.LANCZOS)


def replace_icon_files(source_img: Image.Image):
    """替换所有图标文件"""
    print("替换图标文件...")
    
    for icon_file in ICON_FILES_TO_REPLACE:
        target_path = ASSETS_DIR / icon_file
        
        # 根据文件名确定尺寸
        if "1024" in icon_file or "raw" in icon_file:
            size = 1024
        elif "pro_plus" in icon_file:
            size = 512  # 或其他合适尺寸
        elif "pro" in icon_file:
            size = 512  # 或其他合适尺寸
        else:
            size = 512  # 默认尺寸
        
        try:
            resized = resize_image(source_img, size)
            resized.save(target_path, "PNG")
            print(f"  [OK] {icon_file} ({size}x{size})")
        except Exception as e:
            print(f"  [错误] 无法保存 {icon_file}: {e}")


def main():
    # 确定源文件路径
    if len(sys.argv) > 1:
        source_path = Path(sys.argv[1])
    else:
        source_path = DEFAULT_SOURCE
    
    # 如果是相对路径，尝试从项目根目录解析
    if not source_path.is_absolute():
        if not source_path.exists():
            source_path = ROOT / source_path
        else:
            source_path = Path.cwd() / source_path
    
    if not source_path.exists():
        print(f"[错误] 源图标文件不存在: {source_path}")
        print(f"   请检查文件路径是否正确")
        sys.exit(1)
    
    print("开始替换所有图标...")
    print(f"   源文件: {source_path}")
    print(f"   目标目录: {ASSETS_DIR}")
    print()
    
    # 加载源图像
    print("读取源图标文件...")
    try:
        source_img = load_source_image(source_path)
        width, height = source_img.size
        print(f"成功加载图像: {width}x{height} ({source_img.mode})")
        
        # 检查是否为正方形
        if width != height:
            print(f"警告: 图像不是正方形 ({width}x{height})，将自动裁剪为正方形")
            size = min(width, height)
            # 居中裁剪
            left = (width - size) // 2
            top = (height - size) // 2
            source_img = source_img.crop((left, top, left + size, top + size))
            print(f"   已裁剪为: {size}x{size}")
        
        print()
    except Exception as e:
        print(f"[错误] 加载图像失败: {e}")
        sys.exit(1)
    
    # 确保目标目录存在
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    
    # 替换所有图标文件
    print("=" * 60)
    replace_icon_files(source_img)
    print()
    
    print("=" * 60)
    print("[完成] 所有图标文件替换完成！")
    print()
    print("已替换的文件:")
    for icon_file in ICON_FILES_TO_REPLACE:
        print(f"  - assets/{icon_file}")


if __name__ == "__main__":
    main()

