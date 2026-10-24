---
name: use-bootstrap-icons
description: 在项目 H5 中使用 Bootstrap Icons 离线字体图标。用户需要常规界面图标、导航符号、状态图标、按钮图标、二维码或相机等语义图标时使用；不用于游戏精灵或插画。必须搜索 catalog 返回的精确 className，禁止猜图标名或手写码位。
---

# 使用 Bootstrap Icons

## 资源包

- 包 ID：`bootstrap-icons`
- 固定版本：1.13.1
- 许可证：MIT
- 内容：2,078 个已索引字体图标、CSS、WOFF2 和许可证
- 项目路径：`./assets/vendor/bootstrap-icons/`

只在当前项目的 `resourcePacks` 中存在此包时使用，并把 `bootstrap-icons` 加入 `boltpocket.h5.json.resources`。

## 查找与引用

1. 调用 `project_resource_catalog`，使用 `action: "search"`、`packId: "bootstrap-icons"` 和简短英文语义词，例如 `camera`、`qr-code`、`folder`、`arrow`、`check`。
2. 只使用结果里的 `className`；相近结果不确定时比较名称或换词搜索。
3. 调用 `project_resource_copy`，传入当前 H5 的 `appRoot`、`packId: "bootstrap-icons"` 和 `paths: ["bootstrap-icons.min.css"]`。工具会同时复制 CSS 依赖的 WOFF2。
4. 在 `index.html` 的 `<head>` 引入一次项目样式表：

```html
<link
  rel="stylesheet"
  href="./assets/vendor/bootstrap-icons/bootstrap-icons.min.css"
/>
```

5. 使用 catalog 返回的类名：

```html
<button type="button" aria-label="扫描二维码">
  <i class="bi bi-qr-code-scan" aria-hidden="true"></i>
</button>
```

调整图标只使用 `font-size`、`line-height` 和 `color`。不要读取或手写字体 Unicode 码位，不要自行编码 WOFF2，不要把不存在的名称拼成 `bi-*`。

## 界面规则

- 装饰图标使用 `aria-hidden="true"`；仅图标按钮必须有 `aria-label`，关键动作最好同时显示文字。
- 图标继承当前文字颜色，必须在浅色和深色背景上保持足够对比度。
- 触控区域至少 44 × 44 CSS px；不要为了放大图标缩放整个按钮。
- Bootstrap Icons 适合功能符号，不适合作为游戏角色、品牌插画或大幅背景；这些场景改用更合适的包或项目 SVG/CSS。

最后调用 `preview_project`，确认 CSS 和字体没有 404、图标不是空方框，并检查无障碍名称。
