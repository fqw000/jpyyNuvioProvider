# JPYY Nuvio Provider

为 Nuvio 流媒体应用提供的金牌影视（jpyy）本地 Scraper。支持 **TMDB ID** 和 **站内 ID（jp 前缀）** 双输入格式，通过多语言别名匹配与站内搜索，将 TMDB ID 映射到站内 `vodId`，或直接使用站内 ID 获取多清晰度流地址。

> **注意**：本项目仅提供流地址获取逻辑，不托管、不存储任何视频内容。所有内容均来自第三方站点。

---

## 功能特性

- **双 ID 输入格式**：
  - `tmdbId` 为纯数字（如 `"603"`）→ 走 TMDB 元数据 → 站内搜索 → 匹配 `vodId`
  - `tmdbId` 为 `jp` 前缀（如 `"jp147334"`）→ 直接提取 `vodId`，跳过 TMDB 解析
- **多语言别名匹配**：从 TMDB 拉取所有别名，按"纯中文 > 中文为主 > 其他"排序，提升中文资源匹配率
- **相似度评分**：中文标题用 Jaccard 相似度，英文标题用编辑距离 + 快速预筛
- **年份硬过滤 + 季号硬过滤**：排除明显不匹配的候选
- **多清晰度支持**：返回 4K / 1080p / 720p 等多个清晰度
- **五种内容类型**：电影 / 电视剧 / 综艺 / 动漫 / 短剧
- **内存缓存**：TMDB 元数据 6 小时、站内搜索 5 分钟
- **客户端本地运行**：流地址在用户设备上获取，解决 IP 绑定问题

---

## 在 Nuvio 中使用

### 前提条件

- Nuvio 应用
- 稳定的网络环境（TMDB API 需可访问）
- 有效的 **TMDB API Key**（免费申请，见下文）

### 添加仓库

1. 打开 Nuvio，进入 **Settings → Plugins**。
2. 点击 **Add Repository**。
3. 输入仓库地址（**不带** `manifest.json` 后缀）：
   ```
   https://raw.githubusercontent.com/fqw000/jpyyNuvioProvider/refs/heads/main
   ```
4. 刷新后，在插件列表中找到 **JPYY**，开启开关。
5. 打开任意影片详情页，Nuvio 会自动调用本 Provider 获取流。

---

## 配置 TMDB API Key

本 Provider 走 TMDB ID 路径时依赖 TMDB API。**必须使用你自己的 API Key**，否则会遇到 `HTTP 401 Invalid API key`。

### 申请步骤

1. 访问 [themoviedb.org](https://www.themoviedb.org/) 注册账号（国内可能需要代理）。
2. 登录后进入 **Settings → API**。
3. 点击 **Create → Developer**，填写基本信息提交。
4. 复制 **API Key (v3 auth)**。

### 替换 Key

打开 `providers/jpyy.js`，找到：
```javascript
const TMDB_API_KEY = '';
```
替换为你自己的 Key：
```javascript
const TMDB_API_KEY = '你的新API_KEY';
```

**注意**：如果仓库是公开的，请勿把 Key 直接提交到 GitHub。建议使用私有仓库，或留空让用户自行填写。

---

## 开发

### 目录结构

```
jpyyNuvioProvider/
├── providers/
│   └── jpyy.js              # 单文件 Provider（构建产物）
├── manifest.json            # Provider 注册文件
└── package.json
```

### 本地测试

**1. 启动本地服务器**

```bash
npm start
```
终端会显示本地 URL（如 `http://192.168.1.5:3000`）。

**2. 在 Nuvio 开发版中测试**

- 确保手机和电脑在同一 Wi-Fi。
- Nuvio → **Settings → Developer → Plugin Tester**。
- 输入 `http://192.168.1.5:3000/providers/jpyy.js`，点击 Load。
- 填入 TMDB ID（如 `603` 表示《黑客帝国》）测试。
- 在 **Results** 标签页查看返回结果。

**3. 调试技巧**

- **iOS + Hermes 环境**下 `console.log` 不显示，调试信息通过以下两个字段输出：
  - **失败时**：调试信息写入返回条目的 `url`（如 `https://jpyy.debug/?msg=...`），长按可复制。
  - **成功时**：原始参数信息（`rawId|mediaType|season|episode`）拼在 `name` 字段里。

---

## 常见问题

### Q1：搜索无结果 / 匹配失败

- **检查 TMDB API Key**：如果报 `HTTP 401`，说明 Key 无效或过期。
- **检查站点域名**：`BASE_URL` 可能已失效。jpyy 域名群经常更换，需要手动更新。
- **检查网络**：TMDB API（`api.themoviedb.org`）在国内可能需要代理。

### Q2：Nuvio 直接崩溃

- 确认 `providers/jpyy.js` 中没有 `async/await`、`function*`、`yield`。
- 所有异步操作必须使用 **Promise 链**（`.then()` / `.catch()`）。
- **递归函数必须改为非递归**（避免 Hermes 沙箱栈溢出）。

### Q3：从其他 Addon 进入内容时返回 error

Nuvio 会把内容 ID 原样传入 `tmdbId` 参数。如果该 ID 是站内 ID（`jp` 前缀），本 Provider 会走站内 ID 分支直接处理。如果仍返回 error，长按返回条目的 `url` 复制调试信息，可看到具体失败原因。

### Q4：iOS 上 `console.log` 不显示

这是 Hermes 在 iOS 上的已知问题。调试时请通过 `url` 或 `name` 字段携带诊断信息，在 Results 标签页查看。

### Q5：仓库加载后插件不显示

- 确认 `manifest.json` 中的 `filename` 路径正确。
- 确认 `providers/jpyy.js` 已推送到 GitHub。
- 在 Nuvio 中移除仓库后重新添加，或重启应用。

---

## Manifest 配置说明

`manifest.json` 是 Nuvio 识别 Provider 的入口文件：

```json
{
  "name": "JPYY Repo",
  "version": "1.0.0",
  "scrapers": [
    {
      "id": "jpyy",
      "name": "JPYY",
      "description": "JPYY streaming provider",
      "version": "1.0.0",
      "author": "fqw000",
      "supportedTypes": ["movie", "tv"],
      "filename": "providers/jpyy.js",
      "enabled": true,
      "formats": ["mp4", "mkv"],
      "logo": "",
      "contentLanguage": ["zh", "en"]
    }
  ]
}
```

关键字段：

| 字段 | 必填 | 说明 |
|:---|:---|:---|
| `id` | ✅ | Provider 唯一标识 |
| `name` | ✅ | 显示名称 |
| `filename` | ✅ | JS 文件路径 |
| `supportedTypes` | ✅ | `["movie", "tv"]` |
| `enabled` | ✅ | 是否默认启用 |
| `formats` | ❌ | 支持的格式 |
| `logo` | ❌ | 图标 URL |
| `contentLanguage` | ❌ | 内容语言 |

---

## 技术说明

### 输入参数

Nuvio Provider 的 `getStreams` 函数接收四个参数：

| 参数 | 类型 | 说明 |
|:---|:---|:---|
| `tmdbId` | string | TMDB ID（纯数字）**或**站内 ID（`jp` 前缀） |
| `mediaType` | string | `"movie"` 或 `"tv"` |
| `season` | number \| null | 季数（电影为 `null`） |
| `episode` | number \| null | 集数（电影为 `null`） |

**关键**：Nuvio 会把内容的原始 ID 原样传入 `tmdbId`。当从其他使用站内 ID 的 Addon 进入内容时，收到的可能是 `jp147334` 而非纯数字。

### ID 转换流程

**TMDB ID 路径：**
```
TMDB ID → TMDB 元数据（标题/别名/年份）
       → 多语言别名排序（纯中文优先）
       → 站内搜索
       → 相似度评分（Jaccard / 编辑距离）
       → 年份 + 季号硬过滤
       → 选中 vodId
       → 获取详情 + episodeList
       → 获取流地址
```

**站内 ID 路径：**
```
jp147334 → 提取 vodId = 147334
         → 直接获取详情 + episodeList
         → 获取流地址
```

### 签名算法

站点 API 请求需携带签名：

```
sign = SHA1(MD5(sorted_params + "&key=" + SIGN_KEY + "&t=" + t))
```

### RSC 解析

站点基于 Next.js，页面数据以 `id:data` 格式流式返回。解析器按行切分、JSON 解析、**非递归遍历**（显式栈，避免 Hermes 沙箱栈溢出）。

### typeId1 映射

站点内容的 `typeId1` 字段与内容类型的对应关系：

| typeId1 | 类型 |
|:---|:---|
| 1 | 电影 |
| 2 | 电视剧 |
| 3 | 综艺 |
| 4 | 动漫 |
| 88 | 短剧 |

Provider 根据 TMDB 的 `genres` 和 `origin_country` 推断优先级，例如动画优先匹配 `typeId1=4`。

---

## 免责声明

- 本项目仅用于学习和技术研究。
- 不托管、不存储任何视频内容，所有内容来自第三方站点。
- 用户需自行承担使用风险，并遵守当地法律法规。
- 如有侵权，请联系内容提供方，而非本项目开发者。

---

## 许可

GNU General Public License v3.0