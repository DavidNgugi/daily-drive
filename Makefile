.DEFAULT_GOAL := help

NPM ?= npm
CARGO ?= cargo
NODE ?= node

.PHONY: help install dev build desktop-build clean clean-deps

help: ## Show available commands
	@printf '\033[1;36mDaily Drive desktop commands\033[0m\n'
	@printf '  \033[1;32m%-16s\033[0m %s\n' 'make install' 'Install JavaScript dependencies'
	@printf '  \033[1;32m%-16s\033[0m %s\n' 'make dev' 'Run the desktop app in development mode'
	@printf '  \033[1;32m%-16s\033[0m %s\n' 'make build' 'Build the frontend'
	@printf '  \033[1;32m%-16s\033[0m %s\n' 'make desktop-build' 'Build the macOS app bundle locally'
	@printf '  \033[1;32m%-16s\033[0m %s\n' 'make clean' 'Remove generated frontend and Rust build output'
	@printf '  \033[1;32m%-16s\033[0m %s\n' 'make clean-deps' 'Also remove node_modules'

install: ## Install JavaScript dependencies
	$(NPM) install

dev: ## Run the desktop app in development mode
	$(NPM) run tauri dev

build: ## Build the frontend
	$(NPM) run build

desktop-build: ## Build a local macOS app bundle without updater artifacts
	@set -eu; config=$$(mktemp); trap 'python3 -c "import os,sys; os.unlink(sys.argv[1])" "$$config"' EXIT; \
	  printf '%s\n' '{"bundle":{"createUpdaterArtifacts":false}}' > "$$config"; \
	  $(NPM) run tauri build -- --bundles app --config "$$config"

clean: ## Remove generated frontend and Rust build output
	$(CARGO) clean --manifest-path src-tauri/Cargo.toml
	$(NODE) -e "require('node:fs').rmSync('dist', { recursive: true, force: true })"

clean-deps: ## Remove JavaScript dependencies
	$(NODE) -e "require('node:fs').rmSync('node_modules', { recursive: true, force: true })"
