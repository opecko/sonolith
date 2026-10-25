# Sonolith

@AGENTS.md

## Claude Code specifics

- This file only imports `AGENTS.md`, which holds the rules for every AI assistant. Add shared rules there, not here.
- Personal preferences belong in `CLAUDE.local.md` (gitignored) or `~/.claude/CLAUDE.md`, not in this file.
- Pipe noisy commands through `| tail -n 30`, and don't paste code back in chat: say what changed in a line or two.
