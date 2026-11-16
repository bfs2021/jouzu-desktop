# Contributing to Jouzu Desktop

Thanks for helping. This page says how changes get in, so a pull request can be reviewed
quickly and does not have to be redone.

## Branches

- **Open pull requests against `develop`.** `main` holds released code only and is updated by
  the release process, never by a feature or fix pull request.
- Base your branch on the latest `develop`, and rebase on it if it moves before review.

## Before you write code

- **An issue comes first.** Every bug or change starts as a
  [GitHub issue](https://github.com/shisa-ai/jouzu-desktop/issues). If you want to work on an
  existing issue, say so in the issue first.
- **Name the root cause.** A fix explains why the problem happens, not only what was changed.
  Fixes that hide a symptom (a retry, a delay, a special case, a larger limit) are not accepted.
- **Limits and behaviour follow the Jouzu runtime.** The desktop does not invent its own limits
  or re-implement checks that belong to the runtime.

## What a pull request contains

- **One issue per pull request.** Keep the diff to what the issue needs. Unrelated cleanups,
  renames and formatting go in their own pull request.
- **Reuse what is there.** Use the existing components and patterns in `apps/launcher/src`
  rather than adding new ones. No debug UI, popups or floating toasts.
- **A regression check.** Add or update a test that fails before the change and passes after it.
  UI specs in `apps/launcher/e2e/` run against a stubbed host over HTTP (`/v1/...`); follow an
  existing spec rather than stubbing desktop internals.
- **Evidence.** In the description, say how you verified the change: the commands you ran and
  their results, and screenshots for visible changes.
- **English** for code, comments, commit messages, issues and pull requests.

## Changes that need discussion first

Open an issue and wait for a maintainer to agree before changing any of these:

- `.github/` (workflows, actions, permissions)
- dependencies (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`)
- build, packaging, installer, update feed and release tooling (`packaging/`, `scripts/`,
  `apps/launcher/scripts/`, `apps/launcher/src-tauri/`)
- anything that downloads, executes or sends data to a new location

Pull requests that touch these without a prior agreement are closed.

## Automated contributions

Pull requests written by AI agents or other automated tools are reviewed by the same rules. In
addition:

- Say in the description that the change was produced by a tool, and which one.
- A person must stand behind the pull request and answer review questions.
- Keep to one issue; do not open several speculative pull requests.

## Security

- Never include API keys, tokens, credentials, personal paths or private data in code, tests,
  logs, screenshots or descriptions.
- Report vulnerabilities privately to the maintainers, not in a public issue.

## Review and merge

- Maintainers review every line, including tests and fixtures, before CI is approved for a
  first-time contributor.
- The development gate (`launcher-checks.yml`) must pass. Release builds, the timed playbook
  and stable promotion are run by maintainers, not on pull requests.
- An issue is closed when the fix is merged with evidence and a regression check, and the
  release that contains it is named.

See [README.md](README.md#development) for how to build and run the tests.
