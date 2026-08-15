# Herdr Map — what it is for

> Written after the fact, from the code and from how it is actually used. The
> success criteria below are what the app already does; anything marked
> **[assumed]** is my reading, not something Shaf stated — correct it freely.

## Purpose
One page that shows every AI agent running on this machine and lets you work all
of them from there — read one, answer one, connect several, hand them a job —
without touching the terminal.

**Who it is for:** one person (Shaf) running several coding agents at once on one
Windows machine, on a second screen, glanced at constantly. Not multi-user, not
hosted, not shared. **[assumed]**

## Must-haves — each one testable
1. **Nothing is ever stale by more than ~1.5s.** The map re-reads Herdr on a
   fixed poll; every card shows its own status and how long it has held it.
2. **A stuck agent is obvious without looking for it.** Blocked and finished
   agents are marked in colour on the card, and surface in a "Needs you" lane
   once the map is too big to take in at once.
3. **Any agent can be read and answered from this page** — its live screen, its
   own colours, its slash commands, its numbered menus, and pictures.
4. **Agents can be connected in one gesture,** on the page you are already on,
   and told what that connection means in plain words.
5. **A connection is real instructions, not a drawing.** Sending gives every
   connected group the same job with each agent told its own part.
6. **Nothing irreversible happens without asking.** Closing agents and sending
   to live agents both confirm first.

## Non-goals
- Not a canvas or whiteboard. No free-placed cards, no notes, no drawing tools.
  *(There was a Board; it was removed on 2026-08-15 for being too much.)*
- Not multi-user, not authenticated, not reachable off this machine.
- Not a terminal replacement — Herdr itself is still where an agent lives.
- No framework, no bundler, no npm dependencies.
- No paid API. The app calls the local Herdr CLI and nothing else.

## Constraints
- Windows, one machine, one user.
- **No paid API keys, ever.**
- Must survive Herdr being closed and reopened without a restart.
- Must start instantly — no install step, no build.
