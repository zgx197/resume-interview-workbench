# PostgreSQL Runtime Staging

This directory is reserved for the portable PostgreSQL runtime used by the desktop build.

Expected staged layout:

```text
src-tauri/resources/postgres/windows-x64/
  bin/
  lib/
  share/
  manifest.json
```

Use `npm run desktop:postgres:vendor -- --source <postgres-root>` to populate it.
