Frozen copies of scripts from earlier releases, served at their original addresses (see the
`/src/:file` rewrite in vercel.json) so tabs and caches from those releases keep working.
`v11/src/` is release d3f0ad0, which loaded `/src/*.js?v=11`. From then on releases use
content-hashed files in `/assets/`, which are kept forever and need nothing here.
Never edit these files.
