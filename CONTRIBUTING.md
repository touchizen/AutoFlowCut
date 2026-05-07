# Contributing to AutoFlowCut

Thanks for your interest in contributing! This guide covers the basics of
opening issues, submitting pull requests, and the legal/license requirements
for contributions.

## Quick start

1. **Fork** the repository on GitHub.
2. **Clone** your fork and create a feature branch:
   ```sh
   git clone https://github.com/<your-username>/AutoFlowCut.git
   cd AutoFlowCut
   git checkout -b fix/short-description
   ```
3. **Install dependencies**:
   ```sh
   npm install
   ```
4. **Run tests** before pushing:
   ```sh
   npm run test:run
   ```
5. **Open a pull request** against the `main` branch.

## Code style

- The project uses Vite + React + Electron.
- Follow the patterns documented in `CLAUDE.md` — TDD is required for any
  code change (unit + integration tests where applicable).
- Tests live under `tests/` and mirror the structure of `src/`.
- Use `vitest` for the test runner.

## Reporting issues

Open an issue on GitHub with:
- A clear title and description.
- Steps to reproduce, expected vs. actual behavior.
- Relevant logs (DevTools console or `electron` main-process output).
- Your OS, app version (Settings → About), and Electron build (dev/prod).

For security issues, please do **not** open a public issue — email
`gordon.ahn@touchizen.com` instead.

## Pull-request checklist

Before opening a PR, please confirm:

- [ ] Your changes include tests where applicable.
- [ ] `npm run test:run` passes locally.
- [ ] `npm run build` succeeds.
- [ ] Commit messages follow the existing style
      (`type(scope): short description`, e.g. `fix(video): ...`).
- [ ] Your contribution is your own work (or you have the right to contribute
      it under AGPL v3).

## License

AutoFlowCut is licensed under **GNU AGPL v3.0-only**. See [LICENSE](LICENSE).

By submitting a pull request, you agree that your contribution is licensed
under the same AGPL v3 terms as the rest of the project (this is the standard
GitHub "inbound = outbound" rule). No separate Contributor License Agreement
is required.

If you are contributing on behalf of an employer or another legal entity,
please ensure you have the necessary rights to do so before opening the PR.
For substantial contributions or any uncertainty, feel free to email
`gordon.ahn@touchizen.com` first.

---

*Thanks for helping make AutoFlowCut better.*
