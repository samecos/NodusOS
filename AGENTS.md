# Nodus (结绳) — AI Agent Instructions

## Project Identity

**Nodus (结绳)** is an AI-Native Operating System for developers. Unlike traditional OSes that route through file systems and window managers, Nodus routes through a natural-language intent-understanding engine. The MVP focuses on two foundational capabilities:

- **Semantic Code Index** (the brain) — understand codebases at the symbol/reference/call-graph level
- **Fully Managed Environment** (the hands) — detect, install, and configure runtimes and dependencies with zero user commands

**One-line definition**: Understand your codebase by talking to it. The environment is invisible.

---

## Core Design Principles

These are non-negotiable. Every design and implementation decision must be traceable to one of them.

### Six Principles

| # | Principle | Meaning |
|---|-----------|---------|
| P1 | **Intent-driven, not command-driven** | User expresses *what*, system figures out *how* |
| P2 | **Voice-first, UI as fallback** | 80% of operations should work with eyes closed; UI is auxiliary |
| P3 | **System adapts to human** | Zero learning curve; same engine, different personas (grandma ↔ senior engineer) |
| P4 | **Global context, boundary-less scheduling** | Data lives in one semantic space, not in app silos |
| P5 | **Proactive computation, human-authorized** | System can anticipate but never overstep per-domain user grants |
| P6 | **Cognitive offload, pragmatic degradation** | Automate everything possible; honestly report what's not |

### Six Anti-Principles (what Nodus is NOT)

1. Not an AI wrapper on a traditional desktop (not Copilot in Windows)
2. Not a chatbot interface (not a ChatGPT shell)
3. Does not expose computer concepts to users (no file paths, app names, menus)
4. Not a notification spammer (proactive pushes must pass three gates: authorized domain + value judgment + low intrusion)
5. Not a walled garden (open Skill ecosystem)
6. Does not pretend to be omniscient (degrade honestly when capabilities fall short)

### Conflict Resolution Order

When principles conflict: **Human authorization > Proactive computation > Pragmatic degradation > Experience consistency > Voice-first > Visual presentation > System adapts to human > Feature completeness**

---

## Architecture

### Style: Modular Monolith + Event-Driven

All modules run in one process during MVP. Communication via typed interfaces (TypeScript interfaces / Rust traits) plus a global EventBus for loose coupling. Designed to be splittable into separate processes later.

### Layer Model (top-down dependency only)

```
HUMAN INTERFACE LAYER
  Voice Pipeline (STT/TTS/Wake)  |  Text Input (Ctrl+Space)  |  UI Renderer (Cards, Code View, Breath Light)

INTENT ORCHESTRATION LAYER
  Intent Engine (NLU + Entity Extraction + Classification)  |  Context Manager (File, Cursor, Selection, History)

CAPABILITY LAYER
  Code Intelligence (Parser Mgr, Symbol Extractor, Ref Resolver, CallGraph Builder, Query Engine)
  Environment Manager (Runtime Detection, Installation, Dependency Management)
  Git Intelligence (Log, Diff, Blame)
  File Watcher (FS events → incremental index updates)

DATA & KNOWLEDGE LAYER
  Knowledge Store (SQLite + in-memory index for hot paths)  |  Preferences (KV store)  |  Query History
```

**Rule**: Upper layers may call lower layers. Lower layers may only emit events upward via EventBus — never hold references to upper layers.

### Module Map

| Module | Directory | Status | Responsibility |
|--------|-----------|--------|----------------|
| **Nodus Shell** | `src/shell/` | ⬜ Not started | App lifecycle, module registration, event bus |
| **Intent Engine** | `src/intent/` | ⬜ Not started | NLU: classify intent, extract entities, handle ambiguity |
| **Context Manager** | `src/context/` | ✅ Complete | Track active file, cursor, selection, recent queries |
| **Code Intelligence** | `src/code-intel/` | 🟡 Interface + parsers | Semantic indexing of codebases (tree-sitter) |
| **Environment Manager** | `src/env-mgr/` | ⬜ Not started | Detect, install, configure runtimes and dependencies |
| **Git Intelligence** | `src/git-intel/` | ⬜ Not started | Git log, diff, blame, changed-symbol tracking |
| **File Watcher** | `src/file-watcher/` | ⬜ Not started | FS event monitoring → trigger incremental indexing |
| **Voice Pipeline** | `src/voice/` | ⬜ Not started | Wake word detection, STT, TTS, silent mode |
| **UI Renderer** | `src/ui/` | ⬜ Not started | Card rendering (call graph, references, history), code viewer, status indicator |
| **Knowledge Store** | `src/store/` | ✅ Complete | SQLite persistence + in-memory hot-path indexes |
| **Common Types** | `src/common/` | ✅ Complete | All shared TypeScript interfaces and type definitions |

### Key Data Models

Located in `src/common/types.ts`. Core entities:

- **Symbol** — function, class, interface, variable, etc. with source location, kind, language, signature
- **Reference** — directed edge from one symbol to another (call, import, inheritance, type use, etc.)
- **CallGraph** — nodes + edges representing call relationships, with risk annotations
- **QueryIntent** — structured representation of a natural language query (intent type + extracted entities + confidence)
- **Card** — ephemeral UI unit: call graph card, reference list card, change history card, ambiguity card, env status card
- **ProjectMeta** — detected project metadata: languages, runtimes, package manager, framework, dependencies

---

## Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node.js (TypeScript) | Current implementation language. Long-term plan: Tauri (Rust backend + Web frontend) |
| Database | SQLite via `better-sqlite3` | WAL mode, embedded, zero-config |
| Code Parsing | `tree-sitter` + language grammars | `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python` |
| Testing | Vitest | Unit tests in `src/**/*.test.ts`, integration tests in `src/**/*.integration.test.ts` |
| Type Checking | `tsc --noEmit` | Strict mode enabled |
| Module System | ESM (`"type": "module"`) | NodeNext resolution |
| Target | ES2022 | |

### Future Stack (post-MVP)

- **Application shell**: Tauri (Rust + React frontend)
- **UI**: React 18 + SVG (call graphs) + Monaco Editor (code viewer)
- **Voice (long-term)**: Whisper.cpp (local, offline, privacy-preserving)
- **Build**: Vite

---

## Project Structure

```
NodusOS/
├── docs/                              # Product & architecture docs
│   ├── 01-principles.md               # Core principles & anti-principles
│   ├── 02-personas.md                 # Target user personas
│   ├── 02b-developer-persona-deep-dive.md
│   ├── 02c-developer-native-os.md
│   ├── 03-user-journeys.md            # End-to-end user journeys
│   ├── 04-interaction-paradigm.md     # Voice-first interaction model
│   ├── 05-mvp-scope.md                # MVP feature boundary & success criteria
│   ├── 06-architecture.md             # System architecture (layers, modules, data flows)
│   └── 07-detailed-design.md          # Detailed interface design
├── RequirementAnalysisPhase/          # Phase 1: Product requirements
│   ├── 01-PRD.md                      # Product Requirements Document
│   ├── 02-Wireframes.md               # UI wireframes
│   └── 03-Flowcharts.md               # User flow diagrams
├── ArchitecturalDesignPhase/          # Phase 2: Technical architecture
│   ├── 01-HLD.md                      # High-Level Design (ADR records)
│   ├── 02-DDD.md                      # Domain-Driven Design
│   ├── 03-Database-Schema.md          # SQLite schema design
│   └── 04-API-Reference.md            # Module interface contracts
├── TestDesignPhase/                   # Phase 3: Test strategy
│   ├── 01-Test-Plan.md                # TDD methodology, test pyramid, quality gates
│   ├── 02-Test-Cases.md               # Detailed test cases
│   └── 03-Acceptance-Criteria.md      # User story acceptance criteria
├── src/                               # Source code
│   ├── common/types.ts                # All shared types (Symbol, Reference, CallGraph, etc.)
│   ├── context/                       # ContextManager (✅ complete)
│   ├── store/                         # KnowledgeStore, SQLite implementation (✅ complete)
│   ├── code-intel/                    # CodeIntelligence interface + parsers (🟡 in progress)
│   │   └── parsers/                   # Language-specific tree-sitter parsers
│   ├── shell/                         # Nodus Shell (⬜ not started)
│   ├── intent/                        # Intent Engine (⬜ not started)
│   ├── env-mgr/                       # Environment Manager (⬜ not started)
│   ├── file-watcher/                  # File Watcher (⬜ not started)
│   ├── git-intel/                     # Git Intelligence (⬜ not started)
│   ├── voice/                         # Voice Pipeline (⬜ not started)
│   └── ui/                            # UI Renderer (⬜ not started)
├── tests/
│   └── fixtures/                      # Test fixtures (tiny/medium/large projects)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Development Workflow

### TDD (Test-Driven Development)

Nodus follows **Red-Green-Refactor**. This is mandatory — enforced in code review.

```
RED → GREEN → REFACTOR → (repeat)
```

1. **RED**: Write a failing test that defines the desired behavior
2. **GREEN**: Write the minimal code to make the test pass
3. **REFACTOR**: Improve the code structure while keeping tests green

### Test Pyramid

- **Unit tests** (~65%, ~150 expected): Module-internal logic. Fast (<10s for full suite).
- **Integration tests** (~25%, ~40 expected): Cross-module boundaries, EventBus, KnowledgeStore.
- **E2E tests** (~10%, ~10 expected): Full user journeys from intent to result card.
- **Performance tests** (~5): Key path latency (index, query, env setup).
- **Stress tests** (~3): Large projects (100K+ lines).

Tests live alongside source: `src/<module>/<name>.test.ts` for unit, `src/<module>/<name>.integration.test.ts` for integration.

### Quality Gates

**Pre-commit**:
- All unit tests pass
- `tsc --noEmit` (no type errors)
- Relevant integration tests pass

**Pre-merge (PR)**:
- Full CI suite passes (unit + integration + E2E)
- Code coverage ≥ 85% (new code ≥ 90%)
- No performance regression on critical paths (<10% variance)

**Pre-release**:
- All 10 E2E user journeys pass
- 100K-line project indexing and query performance meets targets
- Author dogfoods for one continuous week without blockers

### Commands

```bash
npm install          # Install dependencies
npm test             # Run all tests (vitest run)
npm run test:watch   # Watch mode for TDD
npm run test:coverage # With coverage report
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run dev          # Development mode (tsx src/main.ts)
```

---

## Coding Conventions

### Module Pattern

Every module follows this structure:

```
src/<module>/
├── <module>.ts              # Public interface (TypeScript interface)
├── <module>.impl.ts         # Default implementation
├── <module>.test.ts         # Unit tests
└── <module>.integration.test.ts  # Integration tests (if applicable)
```

### Naming

- **Interfaces**: PascalCase, no `I` prefix (`ContextManager`, `KnowledgeStore`)
- **Implementations**: `Default` prefix or technology-specific (`DefaultContextManager`, `SqliteKnowledgeStore`)
- **Types**: PascalCase, in `src/common/types.ts`
- **Files**: kebab-case (`context-manager.ts`, `knowledge-store.impl.ts`)
- **Test files**: match the implementation file with `.test.ts` suffix

### TypeScript Rules

- Strict mode enabled (`tsconfig.json`: `"strict": true`)
- `verbatimModuleSyntax`: true — use `import type` for type-only imports
- ESM only (`"type": "module"`, NodeNext resolution)
- No `any` — use `unknown` and narrow with type guards
- Exported interfaces must have JSDoc comments describing purpose

### Module Communication

1. **Direct calls** (preferred): Module A imports Module B's interface and calls methods directly. This is the fast path for query operations.
2. **Event bus** (for loose coupling): Module A emits an event, Module B subscribes. Used for: index status changes, file system events, context changes, environment state transitions.
3. **Never**: Direct access to another module's internal data structures or implementation classes.

---

## MVP Feature Scope

### Included (Must Have)

1. **Environment Autopilot** — auto-detect language, install runtime + dependencies. Supports JS/TS/Python.
2. **Semantic Code Index** — symbol extraction, reference resolution, call graph, change history. Incremental updates on file change.
3. **Six Query Types** — find definition, find references, call graph, impact analysis, change history, symbol overview.
4. **Voice Input** — wake word ("Nodus" / "结绳") → STT → intent parsing.
5. **Text Input** — Ctrl+Space for silent mode text queries.
6. **Result Cards** — call graph card, reference list card, change history card, env status card. Cards are ephemeral (TTL or manual dismiss).
7. **Code Viewer** — syntax-highlighted code display with click-to-navigate from cards.

### Explicitly Excluded (v2+)

- AI code generation / refactoring
- Cross-domain debugging (logs + code correlation)
- Auto-labeling training flywheel
- Multi-device sync
- Languages beyond JS/TS/Python
- Team collaboration features
- Proactive computation / notifications
- External service environments (DB, Redis, etc.)

### MVP Success Criteria

1. Environment ready in ≤ 2 minutes for standard projects, zero manual commands
2. Symbol index coverage ≥ 95%, call graph accuracy ≥ 95% (for projects ≤ 100K lines)
3. Intent-to-card latency ≤ 3 seconds (with index pre-built)
4. Author dogfoods Nodus for daily development for one continuous week

---

## Key Architecture Decisions (ADRs)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-001 | Modular monolith, not microservices | MVP team size, single machine, fast iteration |
| ADR-002 | Local-first, zero cloud dependency | Code privacy, offline capability, zero network latency |
| ADR-003 | Synchronous intent parsing, async indexing | User queries need instant response; indexing is background work |
| ADR-004 | SQLite + in-memory index (dual storage) | Hot-path queries in memory (<1ms), SQLite for persistence and recovery |
| ADR-005 | tree-sitter for code parsing | Language-agnostic, incremental parsing, mature Rust/Node bindings |
| ADR-006 | Interface-as-contract | Every module exposes a TypeScript interface; internals can be freely refactored |

---

## Implementation Status

### Complete
- `src/common/types.ts` — all core data types
- `src/context/` — ContextManager interface + implementation + 7 unit tests
- `src/store/` — KnowledgeStore interface + SQLite implementation + 18 unit tests

### In Progress
- `src/code-intel/` — CodeIntelligence interface defined, LanguageParser interface defined, TypeScript and Python parser implementations exist, tests pending/partial

### Not Started
- `src/shell/` — Nodus Shell (app entry point, module registry, event bus)
- `src/intent/` — Intent Engine (NLU, entity extraction, classification)
- `src/env-mgr/` — Environment Manager (runtime detection, installation)
- `src/file-watcher/` — File Watcher (FS event monitoring)
- `src/git-intel/` — Git Intelligence (log, diff, blame)
- `src/voice/` — Voice Pipeline (wake word, STT, TTS)
- `src/ui/` — UI Renderer (cards, code viewer, breath light)

### Development Order (by dependency)

```
Phase 1 (Infrastructure, no deps):  KnowledgeStore ✅ → ContextManager ✅ → EventBus
Phase 2 (Capabilities):            FileWatcher → GitIntel → EnvManager → CodeIntelligence
Phase 3 (Orchestration):           IntentEngine → VoicePipeline
Phase 4 (Integration):             UIRenderer → NodusShell
```

---

## Important Notes

- Nodus is NOT a code editor replacement. It coexists with VSCode. Nodus is the OS-layer information integrator.
- The project is in early MVP development. Focus on getting the two foundation stones (semantic index + environment autopilot) working end-to-end before adding anything else.
- All code must work fully offline. No cloud service dependencies in MVP.
- The `RequirementAnalysisPhase/`, `ArchitecturalDesignPhase/`, and `TestDesignPhase/` directories contain the canonical design documents. When in doubt about behavior, consult these before the source code.
- Language support is architected to be plugin-based. Adding a new language should require only a new parser implementing the `LanguageParser` interface — no changes to the core indexing engine.
