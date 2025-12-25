#!/usr/bin/env python3
"""
替换 Chatbox 图标为自定义图标

使用方法:
    python scripts/replace-icons.py <source_icon_path>

支持的格式: PNG, ICO, SVG, JPG, JPEG, BMP, GIF
建议使用: PNG (透明背景, 1024x1024 或更大)
"""

import os
import sys
import shutil
from pathlib import Path
from PIL import Image
import subprocess

# 项目根目录
ROOT = Path(__file__).resolve().parent.parent

# 目标目录
ASSETS_DIR = ROOT / "assets"
ICONS_DIR = ASSETS_DIR / "icons"
RENDERER_DIR = ROOT / "src" / "renderer"

# 需要生成的尺寸
ICON_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]


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
        print(f"   支持格式: PNG, ICO, SVG, JPG, JPEG, BMP, GIF")
        raise


def resize_image(img: Image.Image, size: int) -> Image.Image:
    """调整图像大小，使用高质量重采样"""
    return img.resize((size, size), Image.Resampling.LANCZOS)


def generate_png_icons(source_img: Image.Image, output_dir: Path):
    """生成各种尺寸的 PNG 图标"""
    print(f"生成 PNG 图标到 {output_dir}...")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for size in ICON_SIZES:
        resized = resize_image(source_img, size)
        output_path = output_dir / f"{size}x{size}.png"
        resized.save(output_path, "PNG")
        print(f"   [OK] {size}x{size}.png")
    
    # 生成主图标文件
    icon_1024 = resize_image(source_img, 1024)
    (ASSETS_DIR / "icon-1024.png").parent.mkdir(parents=True, exist_ok=True)
    icon_1024.save(ASSETS_DIR / "icon-1024.png", "PNG")
    print(f"   [OK] icon-1024.png")
    
    icon_512 = resize_image(source_img, 512)
    icon_512.save(ASSETS_DIR / "icon.png", "PNG")
    print(f"   [OK] icon.png")


def copy_ico_file(source_ico: Path):
    """复制 ICO 文件到 assets 目录"""
    target = ASSETS_DIR / "icon.ico"
    shutil.copy2(source_ico, target)
    print(f"[OK] 已复制 ICO 文件: {target}")


def generate_icns_file(source_img: Image.Image):
    """生成 macOS ICNS 文件（需要 macOS 系统）"""
    if sys.platform != 'darwin':
        print("[警告] 跳过 ICNS 生成（需要 macOS 系统）")
        return
    
    print("生成 macOS ICNS 文件...")
    
    # 创建 iconset 目录
    iconset_dir = ASSETS_DIR / "icon.iconset"
    iconset_dir.mkdir(exist_ok=True)
    
    # 生成各种尺寸
    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    
    for size, filename in sizes:
        resized = resize_image(source_img, size)
        resized.save(iconset_dir / filename, "PNG")
    
    # 使用 iconutil 转换为 ICNS
    try:
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(ASSETS_DIR / "icon.icns")],
            check=True,
            capture_output=True
        )
        print("[OK] 已生成 icon.icns")
        
        # 清理 iconset 目录
        shutil.rmtree(iconset_dir)
    except subprocess.CalledProcessError as e:
        print(f"[错误] 生成 ICNS 失败: {e}")
        print("   请手动运行: iconutil -c icns icon.iconset -o icon.icns")
    except FileNotFoundError:
        print("[警告] iconutil 未找到，请手动生成 ICNS 文件")


def generate_favicon(source_img: Image.Image):
    """生成 favicon.ico"""
    print("生成 favicon.ico...")
    
    # 生成 16x16 和 32x32 的 favicon
    favicon_16 = resize_image(source_img, 16)
    favicon_32 = resize_image(source_img, 32)
    
    # 保存为 ICO（PIL 支持多尺寸 ICO）
    favicon_path = RENDERER_DIR / "favicon.ico"
    favicon_16.save(favicon_path, "ICO", sizes=[(16, 16), (32, 32)])
    print(f"[OK] 已生成 favicon.ico: {favicon_path}")


def generate_macos_tray_icons(source_img: Image.Image):
    """生成 macOS 托盘图标模板（黑白）"""
    if sys.platform != 'darwin':
        print("[警告] 跳过 macOS 托盘图标生成（需要 macOS 系统）")
        return
    
    print("生成 macOS 托盘图标模板...")
    
    # 转换为灰度
    gray_img = source_img.convert("L")
    
    # 生成 16x16 和 32x32
    icon_16 = resize_image(gray_img, 16)
    icon_32 = resize_image(gray_img, 32)
    
    icon_16.save(ASSETS_DIR / "iconTemplate.png", "PNG")
    icon_32.save(ASSETS_DIR / "iconTemplate@2x.png", "PNG")
    
    print("[OK] 已生成 macOS 托盘图标模板")


def create_ico_from_image(img: Image.Image, output_path: Path):
    """从 PIL Image 创建 ICO 文件（包含多个尺寸）"""
    # 创建多个尺寸
    sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
    images = []
    
    for size in sizes:
        resized = resize_image(img, size[0])
        images.append(resized)
    
    # 保存为 ICO（PIL 支持多尺寸 ICO）
    try:
        images[0].save(output_path, "ICO", sizes=[(s[0], s[1]) for s in sizes])
        print(f"[OK] 已生成 ICO 文件: {output_path}")
    except Exception as e:
        print(f"[警告] 生成 ICO 失败: {e}")
        print("   尝试使用单尺寸...")
        try:
            img_256 = resize_image(img, 256)
            img_256.save(output_path, "ICO")
            print(f"[OK] 已生成单尺寸 ICO 文件: {output_path}")
        except Exception as e2:
            print(f"[错误] 生成 ICO 完全失败: {e2}")
            print("   请使用在线工具手动转换: https://convertio.co/zh/png-ico/")


def main():
    # 检查参数
    if len(sys.argv) < 2:
        print("[错误] 请提供源图标文件路径")
        print()
        print("用法:")
        print("  python scripts/replace-icons.py <source_icon_path>")
        print()
        print("示例:")
        print("  python scripts/replace-icons.py bluestacks-icon.png")
        print("  python scripts/replace-icons.py C:\\path\\to\\icon.png")
        print()
        print("支持的格式: PNG, ICO, SVG, JPG, JPEG, BMP, GIF")
        print("建议: PNG 格式，透明背景，1024x1024 或更大")
        sys.exit(1)
    
    # 确定源文件路径
    source_path = Path(sys.argv[1])
    
    # 如果是相对路径，尝试从项目根目录解析
    if not source_path.is_absolute():
        # 先尝试当前目录
        if not source_path.exists():
            # 尝试项目根目录
            source_path = ROOT / source_path
        else:
            source_path = Path.cwd() / source_path
    
    if not source_path.exists():
        print(f"[错误] 源图标文件不存在: {source_path}")
        print(f"   请检查文件路径是否正确")
        sys.exit(1)
    
    print("开始替换图标...")
    print(f"   源文件: {source_path}")
    print(f"   文件格式: {source_path.suffix}")
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
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    
    # 生成各种格式
    print("=" * 60)
    generate_png_icons(source_img, ICONS_DIR)
    print()
    
    print("=" * 60)
    # 生成 ICO 文件
    if source_path.suffix.lower() == '.ico':
        # 如果源文件就是 ICO，直接复制
        copy_ico_file(source_path)
    else:
        # 否则从图像生成 ICO
        print("生成 Windows ICO 文件...")
        create_ico_from_image(source_img, ASSETS_DIR / "icon.ico")
    print()
    
    print("=" * 60)
    generate_favicon(source_img)
    print()
    
    if sys.platform == 'darwin':
        print("=" * 60)
        generate_icns_file(source_img)
        print()
        
        print("=" * 60)
        generate_macos_tray_icons(source_img)
        print()
    
    print("=" * 60)
    print("[完成] 图标替换完成！")
    print()
    print("注意事项:")
    print("   1. Windows ICO 文件已复制到 assets/icon.ico")
    print("   2. macOS ICNS 文件需要 macOS 系统生成")
    print("   3. 如果 ICNS 生成失败，请手动运行:")
    print("      iconutil -c icns assets/icon.iconset -o assets/icon.icns")
    print("   4. 重新构建应用以应用新图标:")
    print("      npm run build")
    print("      npm run package")


if __name__ == "__main__":
    main()

