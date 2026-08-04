# `building-edgeos-checkout` — a Claude Code skill

A self-contained **Claude Code skill** that teaches an AI coding agent how to
build a custom-styled checkout UI on top of the EdgeOS headless checkout SDK. It
covers **both** paths:

- **`@edgeos/checkout-core`** — framework-agnostic (Vue, Svelte, Solid, vanilla JS, anything)
- **`@edgeos/checkout-react`** — the React adapter (provider + hooks)

The skill ships **inside `@edgeos/checkout-core`**, so every consumer gets it:
a core-only user has it directly, and a React user gets it transitively (the
React package depends on core). Find it at
`node_modules/@edgeos/checkout-core/skills/building-edgeos-checkout/`.

Hand this folder to a client integrating the SDK. Dropped into their Claude Code,
it becomes living documentation: the agent reads the exact store/API/hook
contract and scaffolds a correct integration they can restyle freely.

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
        core-store-reference.md
        example-vanilla.ts
        hooks-reference.md
        example-checkout.tsx
        README.md
```

(Or the user-level `~/.claude/skills/` to make it available across projects.)

Claude Code auto-discovers it from the `SKILL.md` frontmatter. The agent loads it
when the task matches its `description` (building/integrating an EdgeOS checkout).
You can also invoke it explicitly: `/building-edgeos-checkout`.

## Contents

| File | What it is | For |
|---|---|---|
| `SKILL.md` | Entry point: overview, both quick starts, the store surface, the critical contract gotchas, common mistakes. | Everyone |
| `api-contract.md` | Heavy reference: every endpoint + response field, money/status semantics, error codes, the buyer base/`custom_` field split. | Everyone (framework-agnostic) |
| `core-store-reference.md` | The framework-agnostic store: client, `createCheckoutStore`, every action, subscribe/getState, the load-error pattern, analytics. | Non-React (primary) |
| `example-vanilla.ts` | One complete, no-framework integration (plain DOM). Copy and adapt to Vue/Svelte/etc. | Non-React |
| `hooks-reference.md` | The React adapter: `<CheckoutProvider>` + every hook, full signatures, gotchas. | React |
| `example-checkout.tsx` | One complete, type-correct, restyle-me React integration. | React |

## What you (the EdgeOS operator) must give the client

- A **publishable key** (`pk_live_…`) — created in the backoffice under
  *Organization → Checkout SDK Keys*, with the client's origin(s) on the allowlist.
- The **popup slug**.
- (Only if not prod) the **API base URL**, including `/api/v1`.

## Keeping it accurate

The reference files mirror the SDK's public surface and the backend anonymous
checkout schemas. When the SDK's public exports or those schemas change, update
the matching section here (and re-verify both examples typecheck against the SDK).
