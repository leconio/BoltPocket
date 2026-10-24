---
name: publish-skill
description: 当用户要求审核、上传、发布或更新当前项目里的 Skill 到 BoltPocket Skill 市场，或询问为什么某个 Skill 不能上架时使用。只处理项目内确切的 SKILL.md 与公开 README.md；先调用宿主安全审核，修复阻断项后才发布，绝不在聊天或工具参数中复制完整 Skill 内容。
---

# 审核并发布 Skill

1. 调用 `project_context_read`，确认当前对话已绑定项目。用 `find` 确认目标路径为 `/project/skills/<skill-id>/SKILL.md`；缺少明确目标时先询问，不要猜。
2. 市场公开详情只展示 `/project/skills/<skill-id>/README.md`，不会展示 `SKILL.md`。README 必须包含一级标题、用途、预期结果和权限边界，不得复制完整指令、凭据、个人信息、私有路径或内部地址。
3. 当前市场包只发布 `SKILL.md` 和 `README.md`。若 Skill 依赖 `scripts/`、`references/`、`assets/` 或其他同目录文件，说明暂不支持发布，并建议把必要的短说明内联或移除依赖；不要丢弃依赖后谎称包完整。
4. 调用 `skill_market_review`，只传 `skillId`。宿主会从当前项目直接读取两份文件，检查格式、市场名称规范、敏感数据、凭据、越权指令、危险命令和静默写入要求。项目 Skill 名含点、下划线、连续连字符或超过 64 个字符时仍应送审，让宿主返回明确的名称修改建议，不要在调用前自行拦截。不得把文件全文放进工具参数、聊天回复、日志或临时文件。
5. `status` 为 `pass` 时只报告“审核通过”、warning 和 `reviewHash`，不要复述全部检查。`status` 为 `needs_changes` 时逐项报告 finding 的 `target`、`line`、`severity`、`message` 和 `suggestion`，并禁止调用发布工具：
   - 用户只要求审核时，给出精确修改建议后停止。
   - 用户同时要求修复时，用项目 `edit` 或 `write` 形成统一 Diff；说明需在变更应用后重新审核，不能复用旧 `reviewHash`。
6. `status` 为 `pass` 后，仅当用户最新消息明确要求发布或上传时继续。许可证和公开发布者名称不得猜测；缺失时先询问。分类只能是 `engineering`、`operations`、`privacy`、`productivity`、`research` 或 `writing`；选择 1–5 个小写连字符标签；许可证只能是 `Apache-2.0`、`CC0-1.0` 或 `MIT`。
7. 调用 `skill_market_publish`，原样传递本次 `reviewHash`、`skillId` 和公开元数据。宿主会重新读取和审核文件、复核当前市场版本、生成并绑定确定性发布 Patch 的 SHA-256、创建恢复点并应用。审核超过 30 分钟时，若 `SKILL.md`、`README.md` 的摘要和新审核结果完全一致，宿主可直接继续发布；任一内容、审核结论、项目、对话或市场版本变化时必须停止并重新报告，不得绕过。
8. 发布成功后只报告市场 `entryId`、`revision`、Patch SHA-256、回执 ID、恢复可用性和公开 README 详情入口。说明下载者的 `SKILL.md` 会加密存储、界面不可查看，并只在启用它的 Agent 运行期间临时解密。

不要把 README 当作安全审核的替代品，不要把警告隐藏在“已通过”结论里，也不要使用浏览器或普通网络工具绕过宿主发布工具。
