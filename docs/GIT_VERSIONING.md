# Commit avec une nouvelle version

# Git / Versioning (CEP Former)

## Scope

This repository covers CEP Former only.

-   Active branches: `main`, `cep/val`, `cep/prod`
-   Release flow here: CEP Former only

## Rules

-   Do not commit directly to `cep/prod`.
-   Work from `cep/val`.
-   No branches other than `main`, `cep/val`, and `cep/prod`.
-   Merge via PR.
-   Tags are immutable once published.
-   Every tag carries `-rc.N`. A tag without the suffix is a mistake.

## Release flow

1. Branch from `cep/prod`.
2. PR to `cep/val`.
3. Validation in Jelastic VAL.
4. RC tag on `cep/val`: `former-cep-vX.Y.Z-rc.N`.
5. If approved, merge `cep/val` -> `cep/prod`.
6. The approved RC tag follows the commit. Same format on `cep/prod`: `former-cep-vX.Y.Z-rc.N`.

> Since 2026-09-22, **every tag carries `-rc.N`, including on `cep/prod`**. There is no
> "final" tag any more: the suffix is kept in production so that a single look at a tag
> tells which version runs where. When `cep/prod` fast-forwards from `cep/val`, the
> approved RC tag follows the commit and **no new tag is needed** -- check with
> `git tag --points-at HEAD`. Only add the next `-rc.N` if `cep/prod` gets a distinct
> merge commit.

## Current operating rule

-   No branch deletion for now.
-   Keep old branches untouched until global migration is fully validated.
