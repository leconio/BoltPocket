---
name: use-kenney-ui
description: 在项目 H5 或小游戏中使用 Kenney UI Pack 的离线按钮皮肤、控件图标、滑杆、输入框、星标和 Kenney Future 字体。用户需要游戏化 UI、游戏菜单或 HUD 控件时使用；普通应用界面优先使用 CSS 和 Bootstrap Icons。
---

# 使用 Kenney UI Pack

## 资源包

- 包 ID：`kenney-ui`
- 固定版本：2.0
- 许可证：CC0-1.0
- 内容：扫描并精选的 Blue/Default、Extra/Default PNG，以及 Kenney Future 和 Kenney Future Narrow 字体
- 项目路径：`./assets/vendor/kenney-ui/`

只在当前项目的 `resourcePacks` 中存在此包时使用，并把 `kenney-ui` 加入 `boltpocket.h5.json.resources`。

## 查找

调用 `project_resource_catalog`，使用 `action: "search"`、`packId: "kenney-ui"` 和英文文件语义。常用查询包括 `button_rectangle`、`button_round`、`arrow`、`check`、`input`、`slide`、`star`、`future`。必须采用结果返回的精确路径和宽高；不要根据示例猜同系列文件名。

选定后调用 `project_resource_copy`，把实际使用的 PNG 或字体路径复制到当前 H5 的 `appRoot`。不要复制整个包。

选择素材时保持一套一致的风格后缀，例如 `flat`、`depth_flat` 或 `line`，不要在同一组控件中随意混合。图片的扫描尺寸是布局依据，但响应式界面仍需按可用空间缩放。

## 按钮皮肤

PNG 只负责外观，真实交互必须保留语义化元素、文字和焦点状态：

```css
.game-button {
  min-width: 144px;
  min-height: 48px;
  border: 0;
  background: url("../assets/vendor/kenney-ui/png/blue/button_rectangle_flat.png")
    center / 100% 100% no-repeat;
  color: #10233f;
}

.game-button:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 3px;
}
```

```html
<button class="game-button" type="button">开始游戏</button>
```

不要把按钮文字烘焙进图片，不要用纯图片替代 `<button>`、`<input>` 或复选框。切图拉伸明显时保持原始纵横比，或改用 CSS 绘制背景。

## 字体

从 `styles/app.css` 引用字体：

```css
@font-face {
  font-family: "Kenney Future";
  src: url("../assets/vendor/kenney-ui/fonts/kenney-future.ttf")
    format("truetype");
  font-display: swap;
}
```

正文保留系统字体以保证可读性；Kenney 字体优先用于短标题、分数和游戏按钮。提供系统字体 fallback，并验证中文回退效果。

最后调用 `preview_project`，检查所有 PNG、字体、触控区域、焦点样式和窄屏缩放。
