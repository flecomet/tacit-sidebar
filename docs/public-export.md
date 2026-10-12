# Public source publication

The private development repository retains its complete history. The public repository receives selected source snapshots as new commits on its existing `main` branch. Private commits, commit messages, branches and tags are not transferred.

## Export policy

`scripts/publish-public.mjs` selects committed files from `src/`, `public/`, `assets/` and `scripts/`, plus an explicit list of root configuration files, GitHub workflows and public documentation. Other documentation and the GitLab pipeline configuration remain private. Local files, environment files, private-key file extensions and ZIP archives are excluded. Selected symbolic links and submodules stop publication.

Files added under the selected directories become publication candidates automatically. Confidential material must remain outside these directories. Extending the root-file or documentation list requires editing `rootFiles` in the script.

The generated `.public-export.json` records the file modes and content identifiers from the last exported source snapshot. It contains only selected public paths. It allows subsequent exports to compare private development and public contributions against the same baseline.

## Synchronization

The first export finds a shared ancestor in the existing histories. Later exports use the generated manifest. Unchanged source files retain public updates, including refreshed model-catalog fixtures. Source changes replace unchanged public files. A file changed differently on both sides stops publication and lists the conflicting paths. Public files outside the policy also require review before publication.

To resolve a conflict, incorporate the desired public content into the private source file and commit it. The next export proceeds when the contents agree. No forced update is used. A concurrent GitHub update rejects the push; retrying the GitLab job rebuilds against the latest public branch.

The scheduled GitHub model-catalog job remains active. Public contributions must be incorporated into private development before making conflicting changes there.

## Automatic publication

The GitLab pipeline runs after pushes to `main` and can also be started manually. It installs dependencies, runs the tests and builds the selected public candidate before publishing. Jobs are serialized. A job whose source revision is no longer the tip of private `main` skips publication.

The `public-export` environment requires four protected GitLab variables:

- `PUBLIC_EXPORT_SSH_KEY`, a file variable containing the dedicated repository write key.
- `PUBLIC_EXPORT_KNOWN_HOSTS`, a file variable containing GitHub's verified SSH host keys.
- `PUBLIC_EXPORT_GIT_NAME`, the owner's existing Git commit name.
- `PUBLIC_EXPORT_GIT_EMAIL`, the owner's existing Git commit email.

The dedicated write key must be registered on the public repository. Its ability to update `main` depends on the repository's existing branch rules. Personal authentication tokens are not copied into the pipeline.

## Local validation

The default command validates a committed snapshot without publishing. Uncommitted files are excluded, so changes must be committed before they can be previewed. The local GitHub remote supplies the public repository address.

```sh
npm run publish:public
```

The explicit push option publishes the validated snapshot. Git uses the caller's configured identity and signing settings.

```sh
npm run publish:public -- --push
```

`--public-repo` overrides the public repository address, and `--revision` selects a committed source revision. The source checkout and its Git configuration remain unchanged. Temporary public clones are removed after success or failure.
