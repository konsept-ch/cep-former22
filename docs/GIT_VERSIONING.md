# Commit avec une nouvelle version

# Git / Versioning (CEP Former)

## Scope
This repository covers CEP Former only.

- Active branches: `main`, `cep/val`, `cep/prod`
- Release flow here: CEP Former only

## Rules
- Do not commit directly to `cep/prod`.
- Work from `cep/val`.
- No branches other than `main`, `cep/val`, and `cep/prod`.
- Merge via PR.
- Tags are immutable once published.

## Release flow
1. Branch from `cep/prod`.
2. PR to `cep/val`.
3. Validation in Jelastic VAL.
4. RC tag on `cep/val`: `former-cep-vX.Y.Z-rc.N`.
5. If approved, merge `cep/val` -> `cep/prod`.
6. Final tag on `cep/prod`: `former-cep-vX.Y.Z`.

## Current operating rule
- No branch deletion for now.
- Keep old branches untouched until global migration is fully validated.
