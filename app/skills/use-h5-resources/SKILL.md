---
name: use-h5-resources
description: 为项目 H5 查找并复制 App 离线内置的字体图标、游戏 UI 精灵、像素精灵表和示例 Tilemap。用户要求图标、字体、按钮皮肤、游戏素材、角色或场景精灵、Tilemap、离线资源，或 H5/小游戏需要图片资源时使用。必须先通过 project_resource_catalog 取得精确名称，再用 project_resource_copy 复制到当前 H5 应用目录；禁止猜测或引用隐藏路径。
---

# 使用内置 H5 资源

## 选择资源包

只读取实际需要的包级 Skill：

| 需求                                           | 包 ID             | Skill                 |
| ---------------------------------------------- | ----------------- | --------------------- |
| 常规界面图标、状态符号、无障碍图标按钮         | `bootstrap-icons` | `use-bootstrap-icons` |
| 游戏按钮皮肤、复选控件、滑杆、游戏风格字体     | `kenney-ui`       | `use-kenney-ui`       |
| 16px 像素精灵表、Tilemap 示例、Phaser 像素游戏 | `kenney-1bit`     | `use-kenney-1bit`     |

普通应用优先使用 Bootstrap Icons；只有游戏化界面才使用 Kenney UI；只有像素游戏或地图场景才使用 Kenney 1-Bit。选择能完成任务的最小包集合。

## 统一资源包契约

1. 调用 `project_context_read`，只使用 `resourcePacks` 中当前项目已启用的包。
2. 读取对应包级 Skill，再调用 `project_resource_catalog`。先用 `list_packs` 确认包；已知用途时用 `search`、英文关键词和对应 `packId`；浏览目录时用 `list_files`、`offset` 和 `limit`。
3. Catalog 是路径、类型、字节数、SHA-256、图片宽高和图标名称的唯一事实来源。不要猜图标类名、文件名、尺寸、格式或精灵语义。
4. 调用 `project_resource_copy`，传入 `/project/apps/<slug>`、包 ID 和实际需要的 catalog 路径。工具会补齐已知依赖，并把精确字节复制到 `assets/vendor/<pack-id>/`；不要自行 Base64 编码或用 `write` 创建二进制文件。
5. 在 H5 的 `boltpocket.h5.json` 中把已经复制且实际使用的包 ID 加入 `resources`，不要声明未复制或未使用的包。
6. 只引用复制结果返回的项目路径；用 `ls` 或 `find` 确认副本存在，再用 `read` 检查清单与文本引用。
7. 调用 `preview_project` 验证真实加载结果，检查 404、字体回退、图片尺寸和精灵切片；看到错误就修正后重试。
8. 若包未启用或没有合适素材，改用项目内 SVG/CSS 绘制或向用户说明；禁止远程下载脚本、伪造文件路径或绕过项目开关。

App 内只保留一份经过校验的源包；使用时复制选中的文件到项目。项目副本会进入同一份 Diff、恢复点和持久化，可随项目迁移，并且不会被 Agent 当作文本覆盖。

## 清单与路径

清单示例：

```json
{
  "schema": 3,
  "title": "像素游戏",
  "entry": "index.html",
  "profile": "phaser",
  "addons": [],
  "resources": ["bootstrap-icons", "kenney-1bit"],
  "permissions": [],
  "network": []
}
```

复制目标固定为 H5 应用根目录的 `assets/vendor/<pack-id>/`。路径必须按引用文件的位置计算：

- `index.html` 使用 `./assets/vendor/<pack-id>/<path>`。
- `styles/app.css` 使用 `../assets/vendor/<pack-id>/<path>`。
- `scripts/app.js` 使用 `new URL("../assets/vendor/<pack-id>/<path>", import.meta.url).href`。

## 边界

- 这些包随签名 App 发布，运行时不联网更新；实际文件有固定 SHA-256，首次解压会校验。
- Bootstrap Icons 为 MIT；Kenney 两个包为 CC0-1.0。保留 App 内第三方许可记录，不要声称素材为用户或 Agent 原创。
- 复制后的资源是当前项目的固定二进制文件，可由 `ls`、`find` 和文件管理器看到；七个文本工具不能覆盖其内容。
- Kenney 1-Bit 上游没有逐帧语义名称。只能准确依赖精灵表尺寸和切片规则；选择具体帧时必须在预览中核对，不能把猜测写成目录事实。
