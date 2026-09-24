# Whether the board reaches your phone

`wayfinder:grilling` · HITL · blocked by: nothing · assignee: —

## Question

Yao's one idea worth taking is that the same board answers from the desk, the
phone or the browser. This app is already a web page; it just refuses every caller
that is not this machine.

Is answering agents from another room something you want, or noise? It is not free:
the page types into live sessions, so opening it beyond `127.0.0.1` needs a shared
secret at minimum, and that is a security decision, not a convenience one. It also
sets whether the layout has to work at phone width — which changes the card design
and the whole board.

Three shapes to react to: **no** (stays on this machine); **read-only elsewhere**
(you can see who is stuck, but must come to the desk to answer); **full access
behind a secret**.

**Why it blocks:** *What one card shows* and the board layout both change if a
phone has to render them.
