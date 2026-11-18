# Upstream's workflows, parked

These are OpenCode's own workflows, kept where GitHub does not run them: they deploy, publish and
triage for upstream's repository and have no business running in this one. They are moved rather
than deleted so that a merge of upstream still applies upstream's edits to them without a conflict.

A workflow upstream adds later arrives in `.github/workflows/`; move it here in the merge commit
(`git mv .github/workflows/<name>.yml .github/upstream-workflows/`). The `hamzad-check` workflow
fails while anything but `hamzad-*.yml` is in `.github/workflows/`.
