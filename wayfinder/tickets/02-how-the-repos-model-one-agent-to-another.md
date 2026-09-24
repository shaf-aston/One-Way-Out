# How the two repos model one agent's relationship to another

`wayfinder:research` · AFK · blocked by: nothing · assignee: —

## Question

Agent Orchestrator and Yao both let several agents work on one goal. **How does
each one say that two agents are related, and what does the user physically do to
set that up?**

For Agent Orchestrator: what is the orchestrator↔worker relationship in the data
model — a parent field, a task tree, a queue? Can a worker relate to another
worker at all, or only to the orchestrator? What does the user click to make a new
worker exist? Does the user ever draw anything?

For Yao: how does a conversation become a task, a task become work, and a task
become a reusable agent? Is there any structure between agents, or is the board
flat?

Then, blunt: which of the two models is simpler to hold in your head, and what does
each make *impossible* that the other allows?

**Why it blocks:** *The one connection model* is the biggest decision on this map.
One-Way-Out currently has hand-drawn lines with four meanings. Both repos appear to
have no drawing at all. That has to be understood properly, not from a README.
