---
name: build-h5
description: 在当前项目中生成、修改并预览适配移动端的 HTML5 页面、应用、数据可视化与小游戏。用户要求 H5、HTML/CSS/JavaScript、网页 Demo、交互原型、表单、看板、Canvas、浏览器游戏（如贪吃蛇），或打开、预览项目网页时使用。常规应用直接使用 App 离线内置且固定版本的 Preact、Hooks 与 HTM，游戏使用 Phaser；Vanilla 只作为静态降级，禁止自行引入远程脚本。
---

# 生成 H5 项目

## 执行流程

1. 先调用 `project_context_read`，再用 `ls`、`find` 和 `read` 确认现有入口与项目约束。只有产品实际需要内置图标、字体或游戏精灵时，才读取 `use-h5-resources` Skill，用 `project_resource_catalog` 查精确路径，再用 `project_resource_copy` 复制所需文件。纯文字、CSS 或项目 SVG 能完成的普通应用不得仅因资源包已启用就查询目录。
2. 优先沿用已有应用目录。一个项目可以并存多个 H5；创建新 H5 时，从名称生成简短 ASCII slug，使用独立目录 `/project/apps/<slug>/`。由于新项目可能还没有 `/project/apps`，应在始终存在的 `/project` 下用 `find` 匹配 `apps/*/boltpocket.h5.json` 来避免撞名；不要直接以可能不存在的 `/project/apps` 作为查找根目录。禁止创建或覆盖根目录 `/project/index.html`。
3. 按下表选择一个主场景。常规应用直接使用 `preact-htm`，其中已包含 Preact、Hooks 与 HTM；游戏使用 `phaser`。只有纯静态内容或明确不需要状态框架时才使用 `vanilla` fallback。最多使用一个主场景和一个附加组件。
4. 创建 `boltpocket.h5.json`、`index.html`、`styles/app.css` 和 `scripts/app.js`。JavaScript 必须放在本地文件中；禁止内联脚本、内联事件处理器、自定义 Import Map、远程 `<script>`、动态执行下载内容、`eval`、`new Function`、npm、Node、打包器和浮动版本。
5. 使用上游 `write` 创建或完整重写文本文件，使用上游 `edit` 精确修改现有文件。一次运行最多改 10 个文件；更复杂的应用先交付可运行骨架，再增量扩展。所有修改进入同一份可审查 Diff；不能删除文件。
6. 做成移动优先、可触控、可访问并适配安全区的界面。控制 DOM、监听器、定时器、动画循环和日志；页面隐藏、预览收起或游戏结束时暂停不必要的工作。
7. 用 `read` 检查清单、入口和关键引用，再调用 `preview_project`，传入 `/project/apps/<slug>/index.html`。需要原生能力时必须 `present=true`，让用户直接验收可能触发系统授权或选择器的交互；不要尝试替用户授权。
8. 清单 `permissions` 为空时，读取 `operate-browser` Skill，并按其中边界使用预览返回的 `taskId` 做一次最小核心路径冒烟；清单声明任何权限时跳过自动交互，把预览交给用户验收。不要关闭已交给用户的预览。
9. 根据工具结果修正缺失文件、大小写、相对路径、清单和冒烟错误。完成后，该入口会自动出现在项目首页“H5 小程序”中。最终说明入口、选用场景、主要交互、声明的权限、预览与冒烟状态和真实限制。

## 场景选择

| 需求                                      | `profile`    | 规则                                       |
| ----------------------------------------- | ------------ | ------------------------------------------ |
| 常规应用、表单、清单、多视图和复杂状态    | `preact-htm` | 默认；直接使用 Preact、Hooks 和 HTM        |
| Canvas 游戏、精灵、物理、音频、多场景游戏 | `phaser`     | 简单游戏也优先使用离线内置的 Phaser        |
| 纯静态内容或明确不需要状态框架            | `vanilla`    | 仅作 fallback；使用原生 DOM、Canvas 或 SVG |

- 富数据图表可在 `vanilla` 或 `preact-htm` 上添加唯一附加组件 `echarts`。
- `phaser` 不与 `echarts` 叠加。
- 不使用 React、Vue、Lit、Three.js、Tailwind Play CDN 或未登记框架。用户明确需要当前清单没有的运行时，则说明限制并继续使用最接近的内置场景；不要填写其他 CDN 地址。

## 文件结构与清单

```text
/project/apps/<slug>/
├── boltpocket.h5.json
├── index.html
├── styles/app.css
├── scripts/app.js
├── scripts/<feature>.js
├── data/<name>.json
├── assets/<name>.svg
└── assets/vendor/<pack-id>/<copied-file>
```

`boltpocket.h5.json` 必须严格使用以下结构，不添加其他字段：

```json
{
  "schema": 3,
  "title": "应用名称",
  "description": "一句可选简介",
  "entry": "index.html",
  "profile": "preact-htm",
  "addons": [],
  "resources": [],
  "permissions": [
    {
      "id": "location",
      "purpose": "显示附近门店",
      "mode": "once",
      "recipients": ["map-api"]
    }
  ],
  "network": [
    {
      "id": "map-api",
      "origin": "https://map.example.com",
      "purpose": "查询附近门店"
    }
  ]
}
```

- `profile` 只能是 `vanilla`、`preact-htm` 或 `phaser`。
- `addons` 只能为空，或只含 `echarts`。
- `resources` 只能包含当前项目已启用、已通过 `project_resource_copy` 复制且实际引用的 `bootstrap-icons`、`kenney-ui`、`kenney-1bit`。预览不会补造缺失资源；清单声明但项目副本不存在时会失败。
- `permissions` 只声明实际需要的能力，每项都写 `id`、面向用户的具体 `purpose` 和固定 `mode`。允许的 `id` 为 `location`、`camera`、`microphone`、`fileSelection`、`motionSensors`、`clipboardRead`、`clipboardWrite`、`sharing`、`fullscreenMedia`、`autoplayMedia`、`screenWakeLock`、`vibration`、`pictureInPicture`、`airPlay`、`protectedMedia`、`screenOrientation`、`printing`、`barcodeDetection`。
- `location`、`camera`、`microphone`、`fileSelection`、`clipboardRead`、`clipboardWrite`、`sharing`、`printing`、`barcodeDetection` 的 `mode` 必须是 `once`；其余能力必须是 `session`。
- `network` 必须存在；不联网时写空数组。每项只能声明一个规范、精确的 HTTPS 或 WSS origin，不能带路径、查询、账号密码或通配符，并写清具体用途。所有外部 API、WebSocket、图片、字体、样式和媒体来源都必须逐个声明；远程脚本仍禁止。
- `network` 非空时，每项权限都必须写 `recipients`：设备能力产生的数据会发给外部服务时引用对应 `network.id`，仅在小程序本地处理时写空数组。离线小程序可以省略该字段。禁止引用未声明接收方。
- 缺少声明或浏览器总开关关闭的能力会被拒绝。宿主还会按当前小程序及其内容哈希明确征得用户同意；会话授权在隐藏、关闭或内容变化时失效，系统仍可能继续显示自己的权限或选择器。
- `index.html` 只负责语义结构、样式入口和本地脚本入口。所有项目文件引用使用 `./` 或 `../`，且必须留在当前应用目录。
- 通常保持 4 到 9 个文件；不要制造空文件或过细模块。

## 内置运行时用法

框架随 App 打包在一个固定 ZIP 中，首次使用时校验并只解压一份 App 全局只读副本，所有项目 H5 共用，运行时不联网下载组件。项目代码只使用下面的稳定入口，不写框架 URL、版本、哈希或运行时路径。

维护离线 ZIP 时保留多源取包策略：Preact、Hooks、HTM 和 ECharts 按 `npmmirror → jsDelivr → UNPKG` 回退；Phaser 按 `BootCDN → Staticfile → jsDelivr → UNPKG` 回退。每个来源都必须通过固定字节数与 SHA-256 校验后才能进入 ZIP。这只是 App 发版前的构建策略，Agent 生成的项目代码不得包含这些 CDN URL 或自行实现远程加载器。

### Vanilla fallback

仅在不需要框架或需要显式降级版本时，在 HTML 中使用本地模块：

```html
<script type="module" src="./scripts/app.js"></script>
```

使用 `addEventListener` 绑定交互，不写 `onclick` 等内联处理器。

### Preact + Hooks + HTM

App 会按顺序注入固定 UMD 运行时，本地模块从 `globalThis` 取得公开对象：

```js
const { h, render } = globalThis.preact;
const { useEffect, useState } = globalThis.preactHooks;
const html = globalThis.htm.bind(h);
```

组件必须清理定时器、订阅、媒体轨道和动画循环。不要再次导入 Preact，也不要拼接远程模块地址。

### ECharts

声明 `"addons": ["echarts"]` 后使用全局 `echarts`。容器必须有明确高度；尺寸变化时调用 `chart.resize()`，页面隐藏或卸载时调用 `chart.dispose()`。

### Phaser

声明 `"profile": "phaser"` 后使用全局 `Phaser`。优先 Canvas/WebGL 自动选择，暂停隐藏页面的场景，销毁不再使用的游戏实例。图片优先从启用的内置资源包中检索，按 `use-h5-resources` Skill 声明和引用；没有匹配素材时再使用项目 SVG/CSS，或清单已精确声明且用户同意的 HTTPS 媒体来源。

## 浏览器能力

只使用标准 Web API，先做特性检测并提供拒绝或缺失时的降级路径。不要访问、猜测或包装宿主内部 JavaScript 对象。

- 支持 DOM、Canvas、SVG、触摸、指针、键盘、原生 ES Modules、同目录 `fetch()`、Web Audio 和页面生命周期内状态。
- 只有清单 `network` 逐项声明、用户在载入前同意的精确 HTTPS/WSS origin 才能联网，并继续受 CORS 和 CSP 约束；不存在跨域代理。远程 JavaScript、WebAssembly 和其他可执行代码不属于可用网络资源。
- IndexedDB、Cache Storage、Web Crypto、Media Session 和 OPFS 只在检测后用于增强；不要让启动、离线恢复或核心数据依赖它们。项目预览关闭后不保证保留站点数据。Web Worker、Shared Worker 和 Service Worker 不可用。
- 预览与普通浏览器隔离，不共享 Cookie、登录或凭据。只有普通网页使用 App 级共享 Cookie。

### 用户授权能力

- 每个能力都必须在清单里写清真实用途。不要自行制作授权弹窗，也不要把一次点击解释为对其他能力的同意；由宿主统一显示并绑定授权。
- 相机和麦克风使用 `navigator.mediaDevices.getUserMedia()`；只在用户操作后请求，并在完成、隐藏或离开时停止所有 `MediaStreamTrack`。
- 位置使用 `navigator.geolocation`，设置合理 `timeout`，并及时 `clearWatch()`；不要请求后台位置。
- 文件使用 `<input type="file">`，只读取用户明确选择的文件，不能访问任意目录。
- 动作与方向在 iOS 上把 `requestPermission()` 放进用户点击流程。
- 剪贴板使用 `navigator.clipboard.readText()` / `writeText()`，仅响应用户操作；禁止轮询。
- 分享使用 `navigator.share()`，方向使用 `screen.orientation`，打印使用 `window.print()`，常亮使用 `navigator.wakeLock`；分别检测支持情况并在退出时恢复。
- 通过 `navigator.permissions.query()` 查询状态不会产生授权；实际能力调用仍可能出现 `NotAllowedError`。

### 二维码与条码

使用标准 `BarcodeDetector`，不要直接调用宿主桥接。实时扫码同时声明 `camera` 和 `barcodeDetection`。

1. 检测 `BarcodeDetector` 并读取 `getSupportedFormats()`；只使用返回的格式。
2. iOS 与 Android 都可能由宿主在授权后提供 `BarcodeDetector` 兼容层；只使用 `getSupportedFormats()` 实际返回的格式，不区分或探测内部桥接。
3. 实时扫码限制在约 4–8 次/秒，不并发 `detect()`；识别成功、隐藏或退出时停止扫描和摄像头。
4. 跨域图片必须允许 CORS，才能安全读取像素；提供选择图片或手动输入的降级方式。

## 预览与上架边界

- H5 是用户当前项目内、源码可见的私有内容，不建立远程小程序市场、第三方目录、远程清单、隐藏下载入口或跨项目共享执行代码。
- iOS 与 Android 项目 H5 都只调用标准 Web API；宿主可能在用户授权后通过内部兼容层实现该 API。不得访问内部桥接，且所有能力都要检测并准备无能力时的路径。
- App 的运行时登记表和离线 ZIP 随 App 版本发布，不能由服务器远程增加、替换或升级。CDN 分流只在发版前生成 ZIP 时使用；安装后的 App 只校验并复用一份全局离线副本。
- 预览是 App 创建的只读静态快照，不提供 Node、npm、服务端进程、任意文件系统、后台任务或构建服务。
- 禁止表单提交、iframe、插件、外部顶层跳转、弹窗和下载。不要嵌入密码、令牌、私钥、`.env`、项目记忆或 Skill 内容。
- 不依赖 WebAuthn、支付、蓝牙、NFC、USB、Serial、HID、屏幕捕获、Push、后台通知、后台定位、PWA 安装或目录写入。
- 单文件不超过 1 MiB，最多 512 个项目文件，项目快照不超过 8 MiB；共享框架不计入，复制到项目的内置资源按真实字节计入。

## 小游戏验收

制作贪吃蛇等 Canvas 游戏时，同时支持触摸/滑动和键盘，避免立即反向，显示分数和重开入口，正确处理边界、自碰撞、食物生成与暂停。按设备像素比缩放 Canvas，阻止游戏区域手势引发页面滚动，并确保 320pt 宽度仍可操作。
