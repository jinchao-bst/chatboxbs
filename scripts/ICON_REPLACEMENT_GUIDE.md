# 图标替换指南

## 快速开始

### 1. 准备图标文件

将你的图标文件保存到项目目录中，建议：
- **格式**: PNG（推荐）或 ICO
- **尺寸**: 1024x1024 或更大（正方形）
- **背景**: 透明背景（PNG 格式）

### 2. 运行替换脚本

```bash
# Windows
python scripts/replace-icons.py your-icon.png

# macOS/Linux
python3 scripts/replace-icons.py your-icon.png
```

### 3. 支持的格式

- ✅ PNG（推荐）
- ✅ ICO
- ✅ JPG/JPEG
- ✅ BMP
- ✅ GIF
- ⚠️ SVG（需要安装额外库）

## 详细步骤

### 步骤 1: 准备图标文件

1. 将你的图标文件（例如 `bluestacks-robot.png`）放到项目根目录或任意位置
2. 确保图标是正方形（如果不是，脚本会自动居中裁剪）
3. 建议使用透明背景的 PNG 格式

### 步骤 2: 运行脚本

```bash
# 如果图标在项目根目录
python scripts/replace-icons.py bluestacks-robot.png

# 如果图标在其他位置
python scripts/replace-icons.py "C:\path\to\your\icon.png"
```

### 步骤 3: 检查生成的文件

脚本会在以下位置生成图标：

```
assets/
├── icon.ico          # Windows 图标
├── icon.icns         # macOS 图标（仅 macOS 系统生成）
├── icon.png          # 主 PNG 图标 (512x512)
├── icon-1024.png     # 大尺寸图标 (1024x1024)
├── iconTemplate.png  # macOS 托盘图标模板（仅 macOS）
├── iconTemplate@2x.png
└── icons/
    ├── 16x16.png
    ├── 24x24.png
    ├── 32x32.png
    ├── 48x48.png
    ├── 64x64.png
    ├── 96x96.png
    ├── 128x128.png
    ├── 256x256.png
    ├── 512x512.png
    └── 1024x1024.png

src/renderer/
└── favicon.ico       # 网页 favicon
```

### 步骤 4: 重新构建应用

```bash
# 开发环境
npm run dev

# 生产构建
npm run build
npm run package
```

## 注意事项

### Windows

- ✅ ICO 文件会自动生成
- ✅ 所有尺寸的 PNG 图标会自动生成
- ✅ Favicon 会自动更新

### macOS

- ✅ ICNS 文件会在 macOS 系统上自动生成
- ✅ 托盘图标模板会自动生成
- ⚠️ 如果在 Windows/Linux 上运行，ICNS 需要手动生成

### Linux

- ✅ PNG 图标会自动生成
- ✅ ICO 文件会自动生成
- ⚠️ 某些发行版可能需要特定格式

## 手动生成 ICNS（macOS）

如果在非 macOS 系统上运行脚本，需要手动生成 ICNS：

```bash
# 在 macOS 系统上
cd assets
mkdir icon.iconset

# 生成各种尺寸（脚本会自动生成这些文件）
# 然后运行：
iconutil -c icns icon.iconset -o icon.icns
```

## 故障排除

### 问题 1: "无法打开图像文件"

**解决方案**:
- 确保文件路径正确
- 检查文件格式是否支持（PNG, ICO, JPG 等）
- 尝试使用绝对路径

### 问题 2: "生成 ICO 失败"

**解决方案**:
- 使用在线工具手动转换: https://convertio.co/zh/png-ico/
- 或使用 ImageMagick: `magick convert icon.png icon.ico`

### 问题 3: 图标显示不正确

**解决方案**:
- 确保图标是正方形
- 使用透明背景（PNG）
- 重新构建应用: `npm run build`

### 问题 4: macOS ICNS 未生成

**解决方案**:
- 确保在 macOS 系统上运行
- 或手动生成（见上方"手动生成 ICNS"）

## 示例

### 使用 PNG 文件

```bash
python scripts/replace-icons.py bluestacks-robot.png
```

### 使用 ICO 文件

```bash
python scripts/replace-icons.py bluestacks-robot.ico
```

### 使用绝对路径

```bash
python scripts/replace-icons.py "D:\Downloads\bluestacks-icon.png"
```

## 验证

替换完成后，检查以下文件是否存在：

- ✅ `assets/icon.ico`
- ✅ `assets/icon.png`
- ✅ `assets/icons/256x256.png`
- ✅ `src/renderer/favicon.ico`

然后运行 `npm run dev` 查看效果。

