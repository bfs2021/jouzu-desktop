# Contributing to Jouzu Desktop

Thanks for your interest in improving Jouzu Desktop. Bug reports, fixes and improvements are
welcome.

## Reporting a problem

Open a [GitHub issue](https://github.com/shisa-ai/jouzu-desktop/issues). Include the app
version, your operating system, the steps to reproduce, what you expected and what happened,
and the relevant part of `logs/` if there is one. **Settings → System → Report a problem** in
the app opens the issue page. Never paste API keys or other credentials.

## Pull requests

- **Target `develop`.** `main` holds released code only.
- **Start from an issue.** Link the issue the pull request fixes. For a larger change, discuss
  it in the issue before writing code.
- **Explain the root cause.** Say why the problem happens and how the change addresses it.
- **Keep it focused.** One issue per pull request; unrelated cleanups go in their own.
- **Follow the existing code.** Reuse the existing components and patterns.
- **Add a test.** A fix comes with a test that fails before the change and passes after it.
  UI specs in `apps/launcher/e2e/` run against a stubbed host; follow an existing spec.
- **Write in English** for code, comments, commit messages, issues and pull requests.

Changes to CI workflows, dependencies, or build and release tooling should be discussed in an
issue first.

If a pull request was produced with an AI tool, please mention it in the description.

## Development

See [README.md](README.md#development) for how to build the app and run the tests. The CI
checks (`launcher-checks.yml`) must pass before a pull request is merged.

## License

By contributing, you agree that your contributions are licensed under the
[Apache-2.0 License](LICENSE).
