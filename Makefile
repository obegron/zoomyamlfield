SHELL := /bin/bash

.PHONY: help install compile watch lint test build package release clean

help:
	@echo "Targets:"
	@echo "  install  - install dependencies"
	@echo "  compile  - compile TypeScript"
	@echo "  watch    - run compiler in watch mode"
	@echo "  lint     - run eslint"
	@echo "  test     - run tests"
	@echo "  build    - compile + lint + test"
	@echo "  package  - create VSIX package"
	@echo "  release  - create release package"
	@echo "  clean    - remove build output"

install:
	npm ci

compile:
	npm run compile

watch:
	npm run watch

lint:
	npm run lint

test:
	npm run test

build: compile lint test

package:
	npm run package

release:
	npm run package:release

clean:
	rm -rf out *.vsix
