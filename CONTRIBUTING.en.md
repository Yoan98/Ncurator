# Contributing to NCurator

[简体中文](./CONTRIBUTING.md) · **English**

## Discussion and feedback

Report bugs, propose features, or ask questions through [Issues](https://github.com/Yoan98/Ncurator/issues). Community and contact information is maintained in the [README](./README.en.md#get-involved).

Search existing issues first, then choose the matching template in the [issue chooser](https://github.com/Yoan98/Ncurator/issues/new/choose) when possible:

| English template  | Label         | Purpose                                  |
| ----------------- | ------------- | ---------------------------------------- |
| `Bug report`      | `bug`         | Bugs and unexpected behavior             |
| `Feature request` | `enhancement` | New features, requests, and improvements |
| `Question`        | `question`    | Usage questions and discussion           |

Template names, descriptions, and field prompts are in English. You may write your responses in Chinese or English. Templates add the corresponding English label automatically. You can also choose `Blank issue`; a maintainer will add the appropriate label.

Include the app version, operating system, model provider, reproduction steps, and expected and actual behavior. Remove API keys, personal material, and other sensitive information from screenshots and logs. Discuss larger features or architecture changes in an Issue first.

## Development and validation

See the [English README](./README.en.md#run-from-source) for setup. Follow [AGENTS.md](./AGENTS.md) and the [documentation guidelines](./doc/doc-guidelines.md); these engineering documents are currently in Chinese.

Use Node.js 22, pnpm 9.12.2, and Python 3.12. Install macOS Command Line Tools or Windows C++ Build Tools if native modules require compilation. First launch prepares native modules and builds the web crawling sidecar as needed, requiring a network connection. For desktop UI work, start with `pnpm dev:no-sidecar` if the sidecar is unnecessary.

| Command                          | Purpose                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`                       | Start development, preparing native modules and the web crawling sidecar as needed |
| `pnpm dev:no-sidecar`            | Start desktop development without preparing the web crawling sidecar               |
| `pnpm typecheck`                 | Check Main and Renderer types                                                      |
| `pnpm lint`                      | Run ESLint                                                                         |
| `pnpm test:unit --suite <suite>` | Run an affected Unit suite                                                         |
| `pnpm test:ai:non-live`          | Run AI backend checks that do not require live models                              |
| `pnpm build:unpack`              | Build and audit the unpacked app for the current platform                          |
| `pnpm build:win`                 | Build a Windows x64 installer on Windows                                           |
| `pnpm build:mac:arm64`           | Build a macOS arm64 installer on an Apple silicon Mac                              |

Run checks appropriate to the change and record the commands and results in the PR. The [testing documentation](./doc/test.md) defines test layers, filters, and real E2E requirements. Confirm the category of new test files with a maintainer first. Update relevant product requirements and test plans when changing product behavior. Configure your own local credentials for tests that require live model calls.

Keep `.env-example` free of real credentials. Do not commit production shared secrets, model keys, signing certificates, user databases, or test logs. Normal development requires neither COS / R2 upload access nor official service keys. See the [release guide](./doc/deploy/release.md) for official publishing.

## Opening a Pull Request

1. Fork this repository and clone your fork locally.
2. Before starting each change, open your fork on GitHub, select `main`, and click `Sync fork → Update branch` to sync the original repository's latest `main`.
3. Update your local `main` and create a working branch from the latest `main`: use `feat/xxx` for new features and `bugfix/xxx` for bug fixes.
4. Keep each PR focused on one change, run the relevant checks, and update related documentation. Use `git commit --signoff` and retain the `Signed-off-by` confirmation. Use commit messages such as `feat: ...`, `fix: ...`, or `docs: ...`. Aim to squash your changes into one commit before opening the PR to make review and cherry-picking easier.
5. Push your working branch to your fork and open a PR targeting **`dev` in `Yoan98/Ncurator`**. Complete the PR template with related issues, the problem, resulting behavior, validation commands and results, and known limitations. Add screenshots for UI changes.
6. A maintainer reviews the code, and you address the feedback. You may add commits during review. Keep the final change as one complete commit when merging into `dev`, preserving authorship and `Signed-off-by` confirmations.
7. The maintainer runs integration checks and tests on `dev`, then cherry-picks the validated commit to `main`.

After cloning your fork, start each new feature branch with:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/xxx
```

For a bug fix, replace `feat/xxx` with `bugfix/xxx`. Here, `origin` is your fork. Sync your fork on GitHub as described above before updating your local `main`. See GitHub's [fork syncing guide](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork).

Identify the sources and licenses of third-party code, dependencies, images, and other assets.

## Contribution licensing

Read the project's [AGPL-3.0-only license](./LICENSE) before contributing. By submitting a contribution, you confirm that you are authorized to provide it and agree to license it under the same terms. Contributors retain their copyrights. Use commit signoff to record this confirmation.

Obtain any necessary employer or other rights-holder authorization first. Third-party material retains its original license.
