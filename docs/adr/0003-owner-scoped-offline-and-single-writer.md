# Scope offline data by owner and use one scoring writer

Each authenticated user receives an isolated local cache, and one device generation may append events to a live match at a time. An explicit online takeover advances the writer generation while other devices remain read-only, because automatic multi-writer merging cannot preserve rally order when devices work offline.
