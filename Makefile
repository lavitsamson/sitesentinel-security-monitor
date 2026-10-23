# Cluster tasks. Everything else runs through pnpm (see README).
# Without make (e.g. on Windows), run the scripts directly: bash scripts/kind-up.sh

.PHONY: kind-up kind-smoke kind-down

kind-up: ## Create a local kind cluster, build the images and deploy SiteSentinel
	bash scripts/kind-up.sh

kind-smoke: ## Smoke-test the deployment through the ingress
	bash scripts/kind-smoke.sh

kind-down: ## Delete the local kind cluster
	bash scripts/kind-down.sh
