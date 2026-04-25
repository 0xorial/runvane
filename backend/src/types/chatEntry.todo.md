# chatEntry type module TODO

- this file exceeds the 350-line limit and now includes multiple domain concerns (agentic planner schema + timeline entry schemas)
- oversized schema/type files are harder to review safely and easier to regress during protocol changes
- split direction: extract planner-output schemas, attachment schemas, and timeline entry schemas into focused modules, then re-export from a small index
