# Tasks: Improve Shell Usability and Performance

## Lane A: Command Palette and Quick Switching

- [ ] Define a command palette action registry shape and ownership model
- [ ] Add a global `Ctrl/Cmd+K` shortcut, app-level open/close state, and focus restoration behavior
- [ ] Implement a searchable command palette UI shell with grouped results and keyboard navigation
- [ ] Add workspace quick-switch results sourced from workspace alias/name/path/group metadata
- [ ] Register first-release actions: pane switch, terminal creation, add agent/worktree, drawer toggles, settings/profiles, add/open workspace
- [ ] Bridge active-workspace actions through existing handlers or typed custom events rather than duplicating logic
- [ ] Add recent/frequent ranking for high-value actions
- [ ] Validate keyboard conflict and focus restoration behavior with terminal input, slash menus, pickers, and modals

## Lane B: Session Snapshot and Recovery

- [ ] Define a layered recovery scope and explicit non-goals for PTY, worker, and agent sessions
- [ ] Define a recovery snapshot schema for workspace, pane, focused terminal, terminal kind, session linkage, labels, and timestamps
- [ ] Add migration support for older snapshot/profile formats and terminal focus fields
- [ ] Fix renderer persistence gaps for recovery-critical fields (`cwd`, `historyKey`, worktree, pending prompt/images, procfile, recovery state)
- [ ] Persist Claude/Codex recovery metadata, including recoverable/resting/failed states where supported
- [ ] Persist recoverable session snapshot entries with timestamps and labels
- [ ] Add a recovery entry surface on startup or via command palette
- [ ] Add startup rehydration orchestration per terminal kind
- [ ] Restore workspace and focused context from a selected recovery item
- [ ] Clearly communicate what was restored versus what could not be fully resumed
- [ ] Validate recovery behavior for both Claude and Codex session types

## Lane C: Performance and Reliability Guardrails

- [ ] Identify the first extraction seams in Claude/Codex agent panels (`useAgentSession`, transcript, prompt history, task modal, overlays)
- [ ] Identify the first extraction seams in Claude/Codex managers (SDK bootstrap, lifecycle, persistence/archive, task tracking, event translation)
- [ ] Audit long-history rendering and choose a windowed or incremental transcript strategy
- [ ] Normalize repeated transcript derivations so streaming updates do not repeatedly scan full histories
- [ ] Separate file tree navigation from markdown/diagram preview runtime where chunking is currently ineffective
- [ ] Remove or reduce known-fixable build warnings
- [ ] Add regression tests for workspace switching, tab operations, drawer toggling, and recovery flows
- [ ] Add regression tests for session metadata persistence and transcript/archive behavior
- [ ] Add measurable startup/render/session responsiveness checkpoints and chunk-size baselines

## Coordination

- [ ] Confirm shared action names and navigation vocabulary before implementing the command palette
- [ ] Confirm snapshot ownership between renderer store and electron managers
- [ ] Phase refactors so UX-facing behavior changes stay reviewable and reversible
- [ ] Keep implementation lanes parallel where write scopes allow: palette shell, recovery model, and performance/test groundwork
