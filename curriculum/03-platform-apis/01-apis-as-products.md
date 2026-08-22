# 3.1 Platform APIs as products

Competency: the design half of every domain 3 competency (25%), sourced from the [CNCF Platforms white paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/). Needs: nothing running; this is the one reading session in the curriculum. Keep it short and do it before the other five sections, because they all implement ideas named here.

The white paper is the closest thing the CNPE has to a philosophy exam, and it is 13 pages. Read it once end to end. What follows is the compression I would want the night before.

## The definitions that get tested as vocabulary

A platform is an integrated collection of capabilities, defined and presented according to the needs of its users. The key move in that sentence is *users*: a platform is a product with internal customers, not an infrastructure inventory. The paper's attribute list is worth memorising because scenario questions describe violations of it: platform as a product, consistent user experience, documentation and onboarding, self-service, reduced cognitive load, optional and composable, secure by default.

Thinnest viable platform (TVP): the smallest layer that provides consistency and accelerates delivery, deliberately kept small. The paper's example of a minimal platform is a wiki page of provisioning links. The exam-relevant instinct: platform teams build interfaces and experiences, and should *not* rebuild capabilities that managed providers or upstream projects already offer.

Golden path: a templated composition of well-integrated code and capabilities for rapid project development, docs included. The lab implements one literally: Backstage template → new Gitea repo → ApplicationSet picks it up → running workload. Section 3.6 walks it.

Self-service, as the paper means it: a user requests a capability and receives it automatically, without a human in the loop, through a portal, API, or CLI. Every tool in this domain (CRDs, operators, Crossplane, workflows) is a different way to deliver that property.

Measuring platforms: user satisfaction and productivity (surveys, adoption), organizational efficiency (latency from request to fulfillment, time to first code change), and product delivery via the DORA four (deployment frequency, lead time for changes, time to restore, change failure rate). Section 4.5 turns these into PromQL.

Capability domains the paper enumerates, because a "which capability is this" question is cheap to set: web portals, APIs and CLIs, golden path templates, build/test automation, delivery/verification automation, dev environments, observability, infrastructure services, data services, messaging, identity and secrets, security services, artifact storage.

## What "API as contract" means when you design one

The exam's phrase "designing platform APIs" cashes out in domain 3 as: choose the abstraction level (a developer asks for `AppEnvironment` with a team name and a quota, not for a namespace plus a LimitRange plus two NetworkPolicies), validate at admission so mistakes fail fast, report status so consumers can self-diagnose, and version so you can change your mind later. Hold `examples/crossplane/xrd.yaml` up against this list; it is the lab's concrete instance of every point.

## Exercise

One mapping drill, on paper. Take the lab's tool list from `make help` and assign every layer to one or more of the paper's capability domains. Then mark which interfaces each capability is exposed through (portal, API, CLI) in this lab. Verify yourself against the table in the white paper's "Capabilities of platforms" section. Where the lab has no coverage (dev environments, messaging), say so; knowing the map has empty squares is part of knowing the map.

Then one written answer, three sentences, exam style: why should a platform team *not* build its own Postgres operator? If your answer touches TVP, delegation to existing capability providers, and where the platform team's effort should go instead (the interface), you have absorbed the paper.

## Docs to know your way around

- tag-app-delivery.cncf.io/whitepapers/platforms/: the paper itself, plus its glossary (platform engineer vs platform product manager definitions have appeared in practice questions)
- dora.dev: the four keys, one page
