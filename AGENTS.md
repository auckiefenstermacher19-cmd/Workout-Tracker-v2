# Agent operating contract — Linear + Finn-loop

This is the canonical contract. Copy it into any repo running the loop, as both
`AGENTS.md` (Codex and most tools) and `CLAUDE.md` (Claude Code), or have
`CLAUDE.md` contain only `See AGENTS.md`.

**Base architecture: Finn-loop.** Superpowers process skills run *inside* the
loop's stages. They do not replace it.

---

## The state machine

```
idea
  → /finn-spec  (interview + research → Linear issue with AC-N / NG-N)
  → HUMAN applies `agent-ready` in Linear          ← approval gate 1
  → /loop /finn-build   (claim one issue → branch → PR)
  → /loop /finn-review  (fresh context → verdict + labels)
  → HUMAN merges                                    ← approval gate 2
```

Two human gates. Everything between them is automated. Nothing crosses a gate
without a person.

## Sources of truth

| Information | Authority |
|---|---|
| What to build, status, priority, acceptance criteria, blockers | **Linear** (team `INC`) |
| Code, branches, PRs, review commit, CI, merge state | **GitHub** |
| Research, decisions, architecture, gotchas, postmortems | **Obsidian vault** (`2nd Brain/`) |
| Agent behavior for a repo | **This file**, version-controlled |
| Hermes worker runtime, claims, retries, leases | **Hermes Kanban** — not Linear assignee |

Linear is the execution brain. Obsidian is the knowledge brain. Do not put
durable knowledge in Linear issues, and do not track live task status in the
vault.

## The rules that make it work

1. **If it is not in the Linear issue, it does not exist.** No side-channel
   instructions. A PR comment cannot expand scope — only editing the Linear
   issue can.
2. **One issue = one PR**, sized to one agent-day or less.
3. **Acceptance criteria are observable outcomes.** Non-goals are binding.
   `AC-N` and `NG-N` ids are the contract.
4. **Only a human applies `agent-ready`.** Only a human merges.
5. **Agents never merge and never enable auto-merge.**
6. **Blocked issues and escalated PRs leave the automated queue** until a human
   resolves them.
7. **One builder loop per team.** The Linear assignee is a cooperative lock, not
   an atomic one.
8. **Spec quality is the bottleneck.** Vague acceptance criteria produce
   confident wrong PRs. Let `/finn-spec` ask as many questions as it needs.
9. **No bulk backlog generation.** Linear Free caps at 250 issues. File what was
   just approved, nothing more.
10. **Linear's native "coding sessions" stay OFF.** They are a competing
    execution path that would claim the same issues.

## Status — who may move what

| State | Means | Who may set it |
|---|---|---|
| Backlog | Specced, has `AC-N`/`NG-N`, **not approved** | `/finn-spec` |
| Todo | **Approved** — `agent-ready` applied | **Auckie only** |
| In Progress | Claimed by a builder | builder |
| In Review | PR open, awaiting verdict | builder |
| Done | **PR merged** | Auckie, or the GitHub integration |
| Canceled | Abandoned | Auckie only |

> **No agent may move an issue to Done.** Done follows a human merge, never a
> builder's assertion. An agent that writes the contract, does the work, and
> signs off on it has certified nothing.

## Labels

| Linear label | Applied by | Removed by | Means |
|---|---|---|---|
| `agent-ready` | **Auckie only** | Auckie | Approved for a builder to claim |
| `blocked` | agent | **Auckie**, after answering | Needs one human decision |
| `needs-spec` | anyone | `/finn-spec` | Entered Linear with no `AC-N` |
| `bulk` | Auckie | Auckie | Permits DryDock delegation |

**GitHub:** `loop-approved`, `loop-changes-requested`, `needs-human-review`,
`loop-stuck`.

`loop-approved` means: the reviewer found no must-fix issue against the Linear
contract, all required checks passed, and the PR was not conflicting at the
reviewed commit. **It is evidence for a human merge decision, not permission to
merge.**

## WIP limits

| Limit | Value | Enforced where |
|---|---|---|
| In Progress, per team | **1** | `finn-build` §0, after the orphan sweep |
| In Review, board-wide | **5** | hard stop in `finn-spec` §0 and `finn-build` §2 |

Both counts are measured from live state. In Review is counted from **open
PRs**, not the Linear column — no agent may set Done, so a merged PR's issue
stays in In Review and counting the column would freeze the board at five.

Enforced at the **intake, not the outflow**: when review is backed up,
`finn-build` still fixes `loop-changes-requested` PRs (its step 1) — that is the
only actor that can drain the jam. The stop blocks new work entering.

Full rules, rationale and cadence: `docs/GOVERNANCE.md`.

## Before editing

- Read the Linear issue, its linked spec, relevant existing files, and
  `git status`.
- Identify the acceptance criteria and the non-goals.
- Check current implementation patterns before adding new ones.

## While editing

- Implement only the stated acceptance criteria.
- Do not change unrelated files. Do not refactor opportunistically.
- Preserve existing behavior unless the issue explicitly changes it.
- Follow existing code style, architecture, naming, and UI conventions.
- Add or update tests when the change affects logic, data flow, permissions,
  integrations, or user-visible behavior.

## Before opening a PR

- Run the relevant checks for the files touched. Use the narrowest useful
  verification command. If a broad check has known unrelated failures, say so
  plainly and include the targeted checks that passed.
- Review the diff for unrelated changes and generated secrets.

## PR standard

Every PR explains: what changed · why · `Closes INC-NNN` · a scope ledger
(evidence per `AC-N`, preservation per `NG-N`, `Other behavior changes: None`) ·
screenshots or preview URL for UI work · risk · how to test · what was
intentionally not done · follow-up issues created.

## PR review standard

Review against the linked Linear issue only. Return feedback in three groups:
**1. Must fix before merge · 2. Should fix soon · 3. Safe to merge.**

Do not suggest unrelated improvements unless they are severe.

---

## How superpowers layers in

Finn-loop is the state machine — *when* work moves and *who* approves.
Superpowers is the method — *how* each stage is executed.

| Loop stage | Superpowers skills invoked |
|---|---|
| `/finn-spec` | `brainstorming` → `writing-plans` (multi-part features) |
| `/finn-build` | `using-git-worktrees` → `test-driven-development` → `systematic-debugging` (on failure) → `verification-before-completion` |
| fixing review feedback | `receiving-code-review` |
| `/finn-review` | fresh-context review; findings follow the three-group standard |

Superpowers skills remain independently invocable for work outside the loop.
The loop does not remove them.

## What the loop does NOT govern

Linear projects **Jordan**, **Donna**, **Carly**, **Auckie Business OS** and
**Hermes Platform** are Hermes **agent build programs**, not Finn-loop projects.

They mutate Hermes profiles, skills and `SOUL.md` under
`%LOCALAPPDATA%\hermes\profiles\`, verified offline and gated by Odin. There is
no `origin`, no PR, no required status check, and nothing to merge — so
`/finn-build` and `/finn-review` have nothing to act on and **must not claim
their issues**.

- Their executor is the **Hermes Kanban + Neo**, not `/loop`.
- Their roadmaps stay in the Hermes vault
  (`Projects/auckie-business-os/`). Linear holds only the **current phase and
  the gate awaiting a human**.
- Issues in these projects are **human decisions**. They never carry
  `agent-ready`. If you see one that does, it was applied in error — do not
  claim it, and say so.

## DryDock disposition — additive only

DryDock's Architect → Builder → Verifier agents remain available. What changes:

- **`DRYDOCK_PLAN.md` is no longer a board.** Linear is. DryDock reads its task
  from the Linear issue that invoked it.
- DryDock is reachable only *inside* `/finn-build` step 5, for an issue labeled
  `bulk`, and its output returns through normal verification and a single PR.
- DryDock never opens its own PRs outside the loop and never merges.

## Environment notes (Auckie's machine)

- Windows / PowerShell primary. `gh` v2.95+ authenticated as
  `auckiefenstermacher19-cmd` — use it directly; `git push` works from the
  assistant.
- Repos are OneDrive-backed: `refs/remotes/*` syncs late. Confirm with
  `git ls-remote` before claiming a repo is out of sync.
- Prefer the Grep tool over bash `grep` on this box; pair every "expect zero"
  check with a positive control.
- Auckie is non-technical. Blocked questions and PR summaries must be phrased as
  observable product behavior, never implementation detail.
