# dsh-purge 1.1.73 — maintained by lllmzr

An independently maintained fork of [YuJunZhiXue/dsh-purge 1.1.71](https://github.com/YuJunZhiXue/dsh-purge/tree/5e757260a0be055892b48ec520d451cc82e1c191). Original author: YuJunZhiXue. Original copyright: Copyright (c) 2026 小杨. The MIT license and bundled third-party notices are preserved.

[中文说明](README.zh-CN.md) · [Release notes](release-notes.md) · [Development log](DEVLOG.md)

This third-party plugin manages local DeepSeek Harness prompts, rules, patches and an exercise console. Applying patches changes host permission/runtime policies. Passing the included checks is not a guarantee that every use is risk-free.

## Changes

- Fix message submission on 0.2.1: generated persona suffixes use the active session directory as literal text instead of the removed `cwd` prompt variable. Required runtime contexts remain intact.
- Shared HTTP origin and JSON validation; rule mutations require POST.
- Nested-profile uninstall and owned-default-preset cleanup.
- Correct fd routing and concurrent atomic writes; hash/version-tracked backups preserve full restore after repeated Apply.
- Complete staged package upgrades with rollback, local archive detection, and bounded ZIP path/symlink/CRC validation.
- Updates belong to `lllmzr/dsh-purge`; the updater cannot overwrite or hard-reset a source checkout.
- 0.2.1 schema compatibility. Legacy child-tool denies are retained and migrated into an independently guarded leaf preset, without removing delegation restrictions.
- Exercise targets are restricted to loopback/RFC1918 addresses; DNS answers and subsequent tool arguments are checked. This is application policy, not OS-level network isolation.

## Requirements and validation

Node >=22.13.0. Tested with Node 24.13.1 and the official Windows desktop 0.2.1-rc.3 runtime. The checked paths include regression tests, host-copy patch syntax/idempotence/byte-for-byte restore, real configuration composition and local HTTP smoke checks. Other host versions, other desktop OSes and model-output effectiveness are not claimed as verified.

## Manageable source installation

Keep this checkout in a permanent directory. Preview, then apply to the one profile you use:

```powershell
node scripts/manage-install.mjs --home "$env:USERPROFILE/.dsh" --profile desktop
node scripts/manage-install.mjs --home "$env:USERPROFILE/.dsh" --profile desktop --apply
```

The installer backs up the profile manifests, adds a local `link:` dependency and bundle, creates the plugin body entry and a Junction to the source. It does not apply host patches, start the host, download exercise tools, or modify the other profile. Use `--profile web` separately for Web.

Source checkouts are maintained with Git. Commit your work before updating; fully quit/reopen the host afterwards. Automatic Apply/update remain disabled. Keep a complete original host archive before applying patches. Runtime data remains under DSH_HOME.

## Checks

```sh
npm run check
npm test
```

Regression tests need only built-in Node modules and do not require model keys. Host verification scripts additionally require a workspace-local official runtime copy. Runtime copies, installation backups and machine-local reports are excluded from Git.

`node scripts/verify-prompt.mjs --base <absolute-path-to-@deepseek-ai>` reproduces the old error and checks 24 cases / 48 renderings with the actual host renderer, without sending model requests.

See [the historical baseline audit](audit/REVIEW-1.1.71.md) and [mirror provenance](MIRROR-NOTICE.md). This fork is not an official DeepSeek product.
