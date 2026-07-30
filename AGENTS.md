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
  → /finn-spec  (interview + research → Linear issue with AC-N / NG-N + a Lane)
  → HUMAN drags Backlog → Ready                     ← approval gate 1
  → /loop /finn-build   (claim one issue → branch → PR)
  → /loop /finn-review  (fresh context → verdict + labels + Ready To Merge)
  → HUMAN merges                                    ← approval gate 2
```

Two human gates. Everything between them is automated. Nothing crosses a gate
without a person.

## Sources of truth

| Information | Authority |
|---|---|
| What to build, status, priority, acceptance criteria, blockers | **Linear** (team `INC`) |
| Code, branches, PRs, review commit, CI, merge state | **GitHub** |
| Research, decisions, architecture, gotchas, postmortems | **Obsidian vault** (`C:\brain\vault`) |
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
4. **Only a human moves an issue to `Ready`.** Only a human merges.
5. **Agents never merge and never enable auto-merge, and never set `Ready`,
   `Done` or `Canceled`.**
6. **Issues parked in `Needs Me`, and escalated PRs, leave the automated queue**
   until a human resolves them.
7. **One builder loop per repo.** The Linear assignee is a cooperative lock, not
   an atomic one — repo-scoped claims are what make two loops safe, not the
   assignee.
8. **Spec quality is the bottleneck.** Vague acceptance criteria produce
   confident wrong PRs. Let `/finn-spec` ask as many questions as it needs.
9. **No bulk backlog generation.** Linear Free caps at 250 issues. File what was
   just approved, nothing more.
10. **Linear's native "coding sessions" stay OFF.** They are a competing
    execution path that would claim the same issues.

## Lane — who executes it

The board has three orthogonal axes: **lane** (who executes), **status** (what
stage it is at) and **project** (where the code lives). Lane is a Linear **label
group** named `Lane`, whose sub-labels are `loop`, `build`, `hermes` and
`human`. Label groups are mutually exclusive, so an issue carries exactly one
lane.

**Lane names the executor. It never names what the work touches.** A card that
edits a Hermes profile is `Lane/build` when Auckie drives it in a Claude Code
session, and `Lane/hermes` only when Neo runs it. Defining a lane by file
location rather than by executor is the mistake this section exists to prevent.

| Lane | Executor | Attended? | Meaning |
|---|---|---|---|
| `Lane/loop` | `/finn-build` → PR | No — runs unattended | Spec'd and small. **Requires a git repo with a GitHub remote**, since the deliverable is a PR |
| `Lane/build` | Auckie + a Claude Code session | Yes — Auckie is in the session | Too large, exploratory, or interactive for one unattended pass. No repo required |
| `Lane/hermes` | Neo + the Hermes Kanban | No — Odin gates it | Work Neo executes. Not "work that touches Hermes files" |
| `Lane/human` | Auckie's hands or judgment | — | No agent is involved at all: another machine, an account, a web UI, a decision |

**The decision procedure**, in order — one question, asked twice:

```
Does an agent do the typing?
├─ No  ─────────────────────────────────► human
└─ Yes → Does Auckie need to be present?
         ├─ No  ──────────────────────► loop    (unattended, PR, needs a repo)
         └─ Yes → Is Auckie driving it?
                  ├─ Yes ────────────► build
                  └─ No, Neo runs it ─► hermes
```

Separating `human` from `build`: **whose keyboard produces the artifact?** If
Claude Code were unavailable and the work could still be done, it is `human`.
If the whole point is the agent writing things, it is `build`.

Manual moments *inside* a `build` session — a login, a file drop — do not change
the lane. A card is `human` only when the entire card is Auckie's.

Lane is set by `/finn-spec` during the interview and may be changed by Auckie at
any time. An issue with no lane is unclassified and appears in the Triage view.

## Status — who may move what

| State | Means | Who may set it |
|---|---|---|
| Backlog | Captured or specced. **Not approved.** | anyone, incl. agents |
| Ready | **Approved.** Queued for its lane's executor. | **Auckie only — no agent, ever** |
| In Progress | Claimed and being worked | the lane's executor |
| Needs Me | Stalled. Auckie's hands or answer required. | agents and Auckie |
| In Review | PR open, reviewer has not ruled | builder |
| Ready To Merge | Reviewer approved. Awaiting Auckie's merge. | reviewer |
| Done | **PR merged** | Auckie, or the GitHub integration |
| Canceled / Duplicate | Abandoned / folded | Auckie only |

> **`Ready` is the only status no agent may ever write.** It is the arming
> switch and it is human-only, always. An agent that arms its own work has
> approved nothing.

> **No agent may move an issue to Done.** Done follows a human merge, never a
> builder's assertion. An agent that writes the contract, does the work, and
> signs off on it has certified nothing.

Status names are compared as exact strings — `Ready To Merge` carries a capital
`T`.

> **`Lane/human` cards never use `Ready`.** They go `Backlog` → `Needs Me`
> directly. `Ready` means "queued for its lane's executor", and on the human
> lane the executor *is* Auckie — which is exactly what `Needs Me` already
> means. Routing them through `Ready` would hide approved human work from the
> `My Desk` view, which is filtered on `Needs Me` + `Ready To Merge`. Approving
> a human card and parking it for action are the same gesture.

## Labels

| Label | Applied by | Means |
|---|---|---|
| `Lane/loop` | `/finn-spec`, Auckie | Finn loop executes it. Requires a repo. |
| `Lane/build` | `/finn-spec`, Auckie | Auckie + a Claude Code session |
| `Lane/hermes` | `/finn-spec`, Auckie | Neo + the Hermes Kanban |
| `Lane/human` | `/finn-spec`, Auckie | No agent is involved |
| `needs-spec` | anyone | Entered Linear with no `AC-N` |
| `bulk` | Auckie | Permits DryDock delegation |

**`agent-ready` and `blocked` are retired.** Approval is now `status == Ready`,
and parking is now `status == Needs Me`. No agent applies either label. On a
legacy card, `agent-ready` carries no authority — only `status == Ready`
approves — and `blocked` stays in the builder's exclusion filter, harmlessly.

**GitHub:** `loop-approved`, `loop-changes-requested`, `needs-human-review`,
`loop-stuck`.

`loop-approved` means: the reviewer found no must-fix issue against the Linear
contract, all required checks passed, and the PR was not conflicting at the
reviewed commit. **It is evidence for a human merge decision, not permission to
merge.**

## Escalation — park or split

When a build stalls on something only Auckie can do, choose between two
representations using a **mechanical test, not judgment**:

> **Park the card in `Needs Me`** if the human step is one thing Auckie can
> finish at this keyboard in a few minutes — an answer, a value to paste, one
> click.
>
> **Split off a `Lane/human` sub-issue** if it requires leaving this machine,
> creating or owning an account, has more than one step, or outlives this build.

Park is the default and covers most cases. It is one card, one drag to resume.

Split is for real work with its own steps: the sub-issue blocks the parent, and
the builder's blocked-by filter keeps the parent unclaimable until it closes.

## Containers and projects

> **An issue with open sub-issues is never claimable.** Containers are not work;
> Parent auto-close closes them when the last child closes.

Parents carry **no lane** — there is nothing to execute. Enforcement is
structural, not a label: a builder discards any candidate with open sub-issues.
Labels are not inherited by sub-issues, so a lane can never leak from a parent
to its children. Linear shape follows structure, never vault scale: two or more
dependent steps → parent with children, one step → one issue.

> **Every `Lane/loop` issue must name a Linear Project, and a builder may only
> claim issues whose Project matches its own repo's `Linear Project:` line. An
> empty project field is a refusal (`D26`).**

> **Pick-filter warning — never pass `Lane/loop` to the API.** `Lane/loop`,
> `Lane/build`, `Lane/hermes` and `Lane/human` are the *qualified display names*
> used throughout this document. The literal label value Linear stores and
> matches is the **bare sub-label** — `loop`, `build`, `hermes`, `human` —
> inside the label group named `Lane`. A filter on the string `"Lane/loop"`
> matches no issue, so the queue comes back empty and the loop reports "nothing
> to do" forever. Filter on the bare name, and on the group only where the API
> asks for it separately.

Project says *where the code lives*; lane says *who does the work*. Project
never gates whether work happens, only where it happens — the Hermes exclusion
lives entirely on `Lane/hermes`, never on project names. Project is optional for
the `build`, `hermes` and `human` lanes: a card like *delete 5 GitHub PATs* has
no repo and never will. `docs/registry.json` is the machine-readable registry of
Linear Project → project UUID → vault card → repo root → GitHub remote, and is
what `/finn-spec` reads to assign a Project to a new issue;
`docs/portfolio-map.md` is the human-facing view of the same mapping, and where
the two disagree `registry.json` is authoritative.

Key on issue **UUIDs, never on `INC-NNN`** — the identifier is mutable and
changes when an issue moves team.

## WIP limits

| Limit | Value | Enforced where |
|---|---|---|
| In Progress, per repo | **1** | `finn-build` §0, after the orphan sweep |
| In Review, board-wide | **5** | hard stop in `finn-spec` §0 and `finn-build` §2 |

Both counts are measured from live state. In Review is counted from **open
PRs**, not the Linear column — no agent may set Done, so an issue whose PR has
been merged can sit in `In Review` or `Ready To Merge` until the merge closes
it, and counting the column would freeze the board at five.

In Progress is **per repo**, not per team. This is safe because claims are
repo-scoped: two loops standing in two different repos draw from different issue
pools and cannot contend for the same issue.

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

**Issues carrying `Lane/hermes` are executed by Neo and the Hermes Kanban.**
`/finn-build` and `/finn-review` must not claim them. The exclusion keys on the
lane, never on a list of project names.

Why: that work mutates Hermes profiles, skills and `SOUL.md` under
`%LOCALAPPDATA%\hermes\profiles\`, verified offline and gated by Odin. There is
no `origin`, no PR, no required status check, and nothing to merge — so
`/finn-build` and `/finn-review` have nothing to act on.

- Their executor is the **Hermes Kanban + Neo**, not `/loop`.
- Their roadmaps stay in the vault
  (`C:\brain\vault\1-Projects\Internal\Business-OS\`). Linear holds only the
  **current phase and the gate awaiting a human**.
- A `Lane/hermes` issue never carries `Lane/loop` — the group is mutually
  exclusive. If a card that Neo owns has been relabelled `Lane/loop`, it was
  changed in error: do not claim it, and say so.

`Lane/human` issues are likewise outside the loop entirely — no agent is
involved at all.

## DryDock disposition — additive only

DryDock's Architect → Builder → Verifier agents remain available. What changes:

- **`DRYDOCK_PLAN.md` is no longer a board.** Linear is. DryDock reads its task
  from the Linear issue that invoked it.
- DryDock is reachable only *inside* `/finn-build` step 5, for an issue labeled
  `bulk`, and its output returns through normal verification and a single PR.
- DryDock never opens its own PRs outside the loop and never merges.

## Environment notes (Auckie's machine)

```
Linear Project: Workout Tracker
```

Every repo running the loop sets this line to its own Linear Project — it is the
binding that scopes claims to this repo, and it lives in the repo's own contract
rather than in a lookup the builder must resolve at claim time. The same project
names appear in `docs/registry.json`. `finn-build` fails preflight without it.

- Windows / PowerShell primary. `gh` v2.95+ authenticated as
  `auckiefenstermacher19-cmd` — use it directly; `git push` works from the
  assistant.
- Repos are OneDrive-backed: `refs/remotes/*` syncs late. Confirm with
  `git ls-remote` before claiming a repo is out of sync.
- Prefer the Grep tool over bash `grep` on this box; pair every "expect zero"
  check with a positive control.
- Auckie is non-technical. Blocked questions and PR summaries must be phrased as
  observable product behavior, never implementation detail.
