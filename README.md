# KanPan

A 股看盘小工具，数据来自互联网公开接口。Tauri 2（Rust + 纯 HTML/JS，无需 npm 构建），可编译 Android APK 和 Windows exe。

## 功能
- 搜索并添加：大盘指数、个股、ETF、板块/行业指数（代码、名称、拼音都行）
- 自选：默认 16 个标的；点右上角铅笔进入编辑，拖动 ☰ 调整顺序、置顶、删除；表头点「名称/现价/涨跌幅」排序
- 详情页：分时 / 日K / 周K / 月K，涨红跌绿；长按显示十字光标，双指缩放，左右拖动翻看
- 均价线可选 5/10/20/30/60/90/120/250；成交量柱可开关；均量线可选 5/10/60/120（齿轮「指标」里设置）
- 刷新间隔可自定义（10 秒～1 小时，默认 60 秒），默认仅交易时段自动刷新
- 深色/浅色/跟随系统

## 控制请求量
- 所有请求串行，间隔至少 180 毫秒，相同请求自动合并
- 每个周期只请求一次历史 K 线：根数 = 最长均线周期 + 140，最少 160、最多 500（默认 200 根），不翻页
- 45 秒内切换回已看过的周期直接用缓存
- 自动刷新只更新「自选行情 + 当前打开的那一张图」

## 云编译 APK
1. 新建 GitHub 仓库，上传本目录所有文件
2. `.github` 是隐藏文件夹，网页上传常被漏掉：在仓库里点 Add file → Create new file，文件名输入 `.github/workflows/build-apk.yml`，粘贴同名文件内容
3. Actions → Build KanPan APK → Run workflow
4. Artifacts

## 本地编译 Windows 版
```powershell
cargo install tauri-cli --version "^2" --locked
cargo tauri icon app-icon.png
cargo tauri build
```
