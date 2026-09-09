# 译匣（YiXia）

本地离线 **中英互译** 小工具。不连云、不上传文本，在自己电脑上跑一个 OpenAI 兼容的翻译 API，可给 [STranslate](https://github.com/Zggis/STranslate)、沉浸式翻译、浏览器插件等调用。

设计目标：**内存压到约 400 MB**，适合日常办公机长期挂着。

---

## 能做什么

| 能力 | 说明 |
| --- | --- |
| 中英互译 | 只做中文 ↔ 英语（含简繁中文按中文处理） |
| 完全本地 | 模型在本机，断网也能翻（装好之后） |
| 低内存 | 运行时大约 **400 MB** RAM |
| OpenAI 接口 | 插件里选「OpenAI 兼容」即可对接 |
| 可选网页 | 自带一个简单翻译页（可选） |

**做不到的：** 日/韩/法等多语、润色、摘要、按「提示词」自由发挥——它是专用神经机器翻译，不是大语言模型。

---

## 技术简述

```
插件 / 网页
    ↓  HTTP（OpenAI Chat Completions 或 /translate）
FastAPI（本地 127.0.0.1:18790）
    ↓
CTranslate2（CPU int8）
    ↓
Helsinki OPUS-MT（zh↔en，一对模型约 150 MB 磁盘）
```

- **引擎：** [CTranslate2](https://github.com/OpenNMT/CTranslate2) 做 CPU 推理  
- **模型：** Helsinki-NLP OPUS-MT（`gaudi/opus-mt-zh-en-ctranslate2`、`gaudi/opus-mt-en-zh-ctranslate2`）  
- **策略：** 同一时间只加载一个方向（中→英 或 英→中），换向时卸掉上一对，控制 RSS  

曾对比过 NLLB-600M、Hy-MT2 等方案：质量/语种更好，但内存常到 **1 GB+**，不符合「长期挂机」目标，因此最终选定 OPUS-MT。

---

## 环境要求

- Windows 10/11 x64（主要使用场景）或 Linux  
- Python **3.10+**（推荐 3.12）  
- 磁盘约 **500 MB**（venv + 两个模型）  
- 第一次装模型需要联网（可用 Hugging Face 镜像）  

---

## Windows 安装

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

脚本会安装到：

```
D:\tools\yixia\
  server\                 # API 代码
  models\opus\            # 中英模型（磁盘约 310 MB）
  .venv\                  # Python 虚拟环境
  start-yixia.cmd         # 双击启动
  plugin-settings.txt     # 插件填写说明
```

之后双击 **`D:\tools\yixia\start-yixia.cmd`**，保持窗口不要关。

- API：`http://127.0.0.1:18790/v1`  
- 模型名：`yixia`  
- 健康检查：浏览器打开 `http://127.0.0.1:18790/health`  

任务管理器里进程名是 **`python.exe`**（路径在 `D:\tools\yixia\.venv\...`）。刚启动约 150–250 MB，翻过一段落后约 **400 MB**。

### Linux / 开发机

```bash
chmod +x scripts/start-api.sh
./scripts/start-api.sh
```

可选网页 UI：

```bash
npm install && npm run dev
```

---

## 接入插件（STranslate / 沉浸式翻译等）

| 项 | 值 |
| --- | --- |
| 类型 | OpenAI 兼容 |
| Base URL | `http://127.0.0.1:18790/v1` |
| Chat 地址 | `http://127.0.0.1:18790/v1/chat/completions` |
| 模型名 | `yixia` |
| API Key | 任意，例如 `local` |
| 目标语言 | 只选 **中文** 或 **英语** |

### 重要：提示词怎么写

译匣是 **机器翻译模型**，不是 ChatGPT。插件如果带上「请翻译为……」这类指令，可能被当成正文一起翻，结果里就会出现多余前缀。

**推荐（STranslate）：**

- `system`：可留空或删掉  
- `user`：**只填** `$content`  

不要写「请将 $source 翻译为 $target……」。

---

## API 示例

```bash
# 简易翻译接口
curl http://127.0.0.1:18790/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"今天天气真好。","sourceLang":"zh","targetLang":"en"}'

# OpenAI 兼容
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"yixia","messages":[{"role":"user","content":"Hello, world"}]}'
```

---

## 内存对照

| 状态 | 大约占用 |
| --- | --- |
| 进程刚起来（未加载模型） | 150–250 MB |
| 已加载中→英 或 英→中 | **~400 MB** |
| 切换方向 | 仍约 400–430 MB（会卸掉上一对） |

| 方案 | 内存量级 | 本项目是否采用 |
| --- | --- | --- |
| OPUS-MT + CTranslate2 | ~400 MB | ✅ 采用 |
| NLLB-200 600M | ~1.1 GB | ❌ 超预算 |
| Hy-MT2 1.8B（量化） | ~2 GB 级 | ❌ 太重 |

---

## 翻译质量说明（预期）

- **日常网页 / 邮件 / 简单技术文：** 够用，语序大体通顺  
- **专业术语 / 长难句 / 文学：** 不如大模型或在线商用引擎  
- **单独短词：** 偶发重复字（如 `decision` → `决定 决 决…`），服务端已做长度限制与重复清理，但仍受小模型能力上限影响  

若你更在意质量、能接受 1–2 GB 内存，应换更大模型；译匣优先的是「轻、稳、离线、能挂着」。

---

## 常见问题

**Q: 任务管理器里叫什么？**  
A: `Python` / `python.exe`。CMD 窗口标题可能是 YiXia。

**Q: 结果前面多出「请翻译为简化中文…」？**  
A: 插件提示词被送进模型了。把 user 提示词改成 `$content`。

**Q: 窗口一闪就关？**  
A: 多半是 venv 或模型文件不完整。用管理员/普通 PowerShell 看报错；确认 `models\opus` 下两个目录都有 `model.bin` 等文件。

**Q: 国内下模型失败？**  
A: 使用 Hugging Face 镜像，并建议关闭 Xet：

```powershell
$env:HF_ENDPOINT = "https://hf-mirror.com"
$env:HF_HUB_DISABLE_XET = "1"
```

**Q: 能翻译日语吗？**  
A: 不能。当前刻意只保留中英，以换取低内存。

---

## 目录结构（安装后）

```
D:\tools\yixia\
├── start-yixia.cmd          # 双击启动
├── plugin-settings.txt      # 插件填写备忘
├── .venv\                   # Python 依赖
├── models\opus\             # OPUS-MT 中英模型
│   ├── opus-mt-zh-en-ctranslate2\
│   └── opus-mt-en-zh-ctranslate2\
├── server\                  # FastAPI 服务
└── scripts\                 # 启动 / 安装脚本
```

---

## 许可与致谢

- 本工具编排代码按仓库 LICENSE 使用（若未附带则默认与作者约定为准）  
- 模型来自 [Helsinki-NLP / OPUS-MT](https://opus.nlpl.eu/Opus-MT/) 生态及社区 CTranslate2 转换版  
- 推理后端：[CTranslate2](https://github.com/OpenNMT/CTranslate2)  

---

**一句话：** 译匣 = 本机挂一个约 400 MB 的中英翻译 API，给翻译插件当「本地 OpenAI」。
