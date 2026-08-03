# `building-edgeos-checkout` — a Claude Code skill

A self-contained **Claude Code skill** that teaches an AI coding agent how to
build a custom-styled checkout UI on top of the EdgeOS headless checkout SDK
(`@edgeos/checkout-core` / `@edgeos/checkout-react`).

Hand this folder to a client integrating the SDK. Dropped into their Claude Code,
it becomes living documentation: the agent reads the exact API/hook contract and
scaffolds a correct integration they can restyle freely.

## Install (client side)

Copy this whole `building-edgeos-checkout/` directory into the project's skills
directory:

```
your-project/
  .claude/
    skills/
      building-edgeos-checkout/
        SKILL.md
        api-contract.md
        hooks-reference.md
        example-checkout.tsx
        README.md
```

(Or the user-level `~/.claude/skills/` to make it available across projects.)

Claude Code auto-discovers it from the `SKILL.md` frontmatter. The agent loads it
when the task matches its `description` (building/integrating an EdgeOS checkout).
You can also invoke it explicitly: `/building-edgeos-checkout`.

## Contents

| File | What it is |
|---|---|
| `SKILL.md` | Entry point: overview, quick start, the hooks, the critical contract gotchas, common mistakes. |
| `api-contract.md` | Heavy reference: every endpoint + response field, money/status semantics, error codes, the buyer base/`custom_` field split. |
| `hooks-reference.md` | Every hook + store action with full signatures, plus the load-error pattern and analytics adapters. |
| `example-checkout.tsx` | One complete, type-correct, restyle-me integration. Copy as a starting point. |

## What you (the EdgeOS operator) must give the client

- A **publishable key** (`pk_live_…`) — created in the backoffice under
  *Organization → Checkout SDK Keys*, with the client's origin(s) on the allowlist.
- The **API base URL** (including `/api/v1`).
- The **popup slug**.

## Keeping it accurate

The reference files mirror the SDK's public surface and the backend anonymous
checkout schemas. When the SDK's public exports or those schemas change, update
the matching section here (and re-verify the example typechecks against the SDK).
