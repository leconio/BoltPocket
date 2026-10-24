---
name: use-kenney-1bit
description: 在项目 H5 像素游戏中使用 Kenney 1-Bit Pack 的 16px 离线精灵表和 Tilemap 示例。用户要求像素角色、地块、平台游戏、迷宫、地图、Phaser 精灵或复古游戏素材时使用。上游没有逐帧语义名称，具体帧必须通过预览核对，禁止臆造帧含义。
---

# 使用 Kenney 1-Bit Pack

## 资源包

- 包 ID：`kenney-1bit`
- 固定版本：1.2
- 许可证：CC0-1.0
- 基础 tile：16 × 16 px
- 布局：49 列 × 22 行，共 1,078 帧
- 项目路径：`./assets/vendor/kenney-1bit/`

只在当前项目的 `resourcePacks` 中存在此包时使用，并把 `kenney-1bit` 加入 `boltpocket.h5.json.resources`。

## 选择精灵表

用 `project_resource_catalog` 的 `list_files` 或 `search` 查询 `tilesheets`、`packed`、`transparent`、`colored`、`monochrome`。必须采用 catalog 返回的精确路径和尺寸。

选定精灵表后调用 `project_resource_copy`，把精确路径复制到当前 H5 的 `appRoot`。只复制游戏实际使用的表或地图文件。

- 无间距 packed 表是 784 × 352 px；每帧 16 × 16，坐标为 `column * 16, row * 16`。
- 1px 间距表是 832 × 373 px；`margin: 0`、`spacing: 1`，坐标为 `column * 17, row * 17`。
- 帧号统一为 `row * 49 + column`。

上游没有逐帧语义名称或权威帧标签。Skill 只能保证切片规则，不能保证某个帧号是人物、食物或墙体。选择帧时先做小型精灵预览网格并人工观察，再把核对后的帧号写入游戏；不要把猜测写成 catalog 事实。

## Phaser

优先使用无间距透明彩色表：

```js
const sheet = new URL(
  "../assets/vendor/kenney-1bit/tilesheets/colored-transparent_packed.png",
  import.meta.url,
).href;

// scene.preload
this.load.spritesheet("tiles", sheet, {
  frameWidth: 16,
  frameHeight: 16,
});
```

间距版额外传入 `margin: 0, spacing: 1`。不要在每帧重复加载纹理、创建图片或重建动画；预加载一次并复用帧。

## Canvas

packed 表的切片公式：

```js
const column = frame % 49;
const row = Math.floor(frame / 49);
context.imageSmoothingEnabled = false;
context.drawImage(sheet, column * 16, row * 16, 16, 16, x, y, 32, 32);
```

CSS 设置 `image-rendering: pixelated`，按整数倍缩放，避免半像素坐标造成模糊。

## Tilemap 边界

`tilemaps/*.tmx` 是示例地图，`tilemaps/tileset_colored.tsx` 是 Tiled 元数据。先用 catalog 确认精确文件名。H5 运行时没有通用 TMX 解析器；简单项目优先把关卡写成项目内受控的 JSON/数组。需要解析示例时只读取 XML 文本并实现任务所需的最小字段，禁止引入远程解析脚本。

最后调用 `preview_project`，检查纹理是否加载、切片是否错位、透明背景、像素缩放以及页面隐藏时的游戏暂停。
