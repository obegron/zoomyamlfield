# Change Log

All notable changes to the "zoomyamlfield" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.4]

- Refresh development dependencies and override `serialize-javascript` to `7.1.0` to resolve its high- and moderate-severity advisories.
- Restore compatibility with TypeScript 6 and current Node, Mocha, and VS Code type definitions, and align the minimum VS Code version to 1.120.
- Add the missing VS Code extension test launcher so the test suite runs correctly.
- Make release packaging target only the current version and exclude internal development metadata.

## [0.1.3]

- Fix path handling for YAML keys containing dots, including `data."settings.xml"`.
- Fix zoom/edit lookup so dotted keys no longer resolve as nested keys.
- Preserve object values for previews instead of collapsing them to `[object Object]`.
- Align the declared VS Code engine with the current release toolchain.

## [0.1.2]

- Initial release
