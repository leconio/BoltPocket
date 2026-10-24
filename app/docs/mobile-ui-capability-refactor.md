# Mobile UI and capability-scope refactor

This branch implements the 35-item Expo mobile UI, Skill, MCP, and connector
cleanup agreed on 2026-08-15. This checklist keeps implementation, migration,
and regression coverage aligned.

## Scope model

| Capability | Global responsibility                        | Project responsibility                                         |
| ---------- | -------------------------------------------- | -------------------------------------------------------------- |
| Skill      | installed inventory and inherited defaults   | override and project-owned Skills                              |
| MCP        | none                                         | connection, enablement, authentication policy, and tool policy |
| Connector  | reusable secure credential/account reference | grant and resource scope                                       |

Globally enabled Skills are inherited by every project unless that project has
an explicit override. MCP servers and ordinary connectors remain project
scoped. A quick conversation without a project receives none of them.

## Shared-component rule

Repeated mobile patterns use repository-owned shared components. Page
scaffolds, search fields, form fields, capability rows, segmented controls,
icons, empty/error states, and project-scope guards are implemented once and
composed by Skill, MCP, connector, settings, and model screens. Components are
shared only when their semantics and behavior match.

## Shared motion

Bottom sheets use React Native Modal's built-in slide transition instead of a
custom animation. When the operating system enables Reduce Motion, the shared
sheet uses the built-in no-animation mode. Screens do not define their own
sheet timing, easing, or displacement.

## Acceptance checklist

### P0 mobile usability

1. Maximum Dynamic Type keeps every primary title, choice, field, and action readable.
2. Header titles and actions remain usable at 320 pt and with long localized text.
3. Scroll and fixed surfaces consume top and bottom safe-area insets exactly once.
4. Keyboard avoidance keeps the focused field and submit action visible on iOS and Android.
5. Interactive controls expose at least a 44 by 44 point target.
6. Light-mode tertiary text is not used below accessible contrast for meaningful copy.
7. Decorative icons are hidden from accessibility; controls and fields have semantic labels.
8. Older encrypted snapshots migrate through supported schema versions instead of failing immediately.
9. Errors are announced, selectable where useful, and paired with a recovery action when possible.

### P1 capability information architecture

10. Install, enable, and grant are distinct product actions.
11. The global Skill screen displays and controls app-wide enablement defaults.
12. Skill Add accepts any HTTPS URL returning a complete `SKILL.md` on a separate route.
13. Skill and MCP screens expose no search or source-management concepts.
14. Add Skill accepts a direct document URL and does not expose MCP authentication complexity.
15. Custom MCP connections are owned and enabled by exactly one project.
16. The existing MCP editor structure is retained while scope and responsive layout are corrected.
17. Connector credentials may be reused, but grants remain project-scoped.
18. MCP Add accepts one explicit HTTPS endpoint inside the project editor.
19. Global navigation no longer exposes global MCP enablement.
20. Project details expose Skills, MCP, and Connections as separate project capabilities.
21. Duplicate scope badges, empty-state actions, and empty searches are removed.
22. MCP authentication, tool allow-lists, and write approval remain inspectable.
23. Capability persistence uses explicit inventory, binding, connection, grant, and credential entities.
24. Legacy Skill defaults and explicit project overrides retain their precedence during migration.
25. Tests prove project isolation, inherited Skill defaults, project overrides, migration, and revocation.

### P2 Expo-native consistency

26. Growing collections use virtualized lists.
27. Ordinary routes progressively use native Stack headers and automatic insets.
28. Long forms use routes; short transient choices use sheets with one close mechanism.
29. Context-window selection uses the native Slider control.
30. Motion respects Reduce Motion and uses Reanimated for app-owned animated state.
31. Shared icons use an iOS SF Symbol and Android vector abstraction.
32. Chat controls prioritize core actions on narrow screens and remain horizontally reachable.
33. Empty chat uses the product mark instead of a placeholder letter.
34. Settings and drawer labels reflect the new scope model without repeated headings.
35. Development diagnostics cannot obscure production controls.

## Required verification

- `pnpm --filter @boltpocket/mobile lint`
- `pnpm --filter @boltpocket/mobile typecheck`
- `pnpm --filter @boltpocket/mobile test`
- Android device: light/dark, 320 pt-equivalent width, maximum font scaling,
  accessibility semantics, keyboard-safe layout, Skill add, project MCP, project
  connector, shared-sheet close behavior, and model context slider.
- Android compilation uses the user-owned `207` workstation and the repository
  Docker builder. No hosted build is authorized by this work.

## Device verification record

On 2026-08-15 the Debug development build compiled successfully on `207` and
ran on the Vivo API 35 test device. The device walk verified the home project
list, project capability separation, project-only MCP, a native context-window slider that remains on
screen during a left drag, one semantic close action per sheet, dark mode, a
320 pt-equivalent viewport, and Android font scale 2.0. Device display settings
were restored after the checks.
