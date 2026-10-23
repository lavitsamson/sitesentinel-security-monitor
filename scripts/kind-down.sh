#!/usr/bin/env bash
# Deletes the local kind cluster and everything in it (including its volumes).
set -euo pipefail
kind delete cluster --name sitesentinel
