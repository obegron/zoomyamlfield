# Change Log

All notable changes to the "zoomyamlfield" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.3]

- Fix path handling for YAML keys containing dots, including `data."settings.xml"`.
- Fix zoom/edit lookup so dotted keys no longer resolve as nested keys.
- Preserve object values for previews instead of collapsing them to `[object Object]`.
- Align the declared VS Code engine with the current release toolchain.

## [0.1.2]

- Initial release
