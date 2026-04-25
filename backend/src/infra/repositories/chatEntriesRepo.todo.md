# chatEntriesRepo TODO

- this repo must now be aware of payload properties. this should be done outside (or if it is absolutely impossible, we need a db column)
- split into multiple files
- new `thought-prepare.title` increased payload mapping surface; extract per-entry-type mappers to dedicated modules to keep this file maintainable
- provider+model persistence (`llmProviderId` + `llmModel`) further increased payload branching; extract shared payload read/write helpers per thought entry kind
