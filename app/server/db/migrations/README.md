# SQL Migrations

This directory stores ordered SQL migrations for the PostgreSQL database.

Conventions:

- Use zero-padded prefixes such as `0000_`, `0001_`, `0002_`
- Keep each migration idempotent when practical
- Put one logical change set in one file
- Prefer additive changes first to support gradual rollout

The first migration enables required extensions so later schema migrations can assume they exist.
