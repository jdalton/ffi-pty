# Windows helper signing

Run **sign: windows helpers** (`sign-windows-helpers.yml`) from `main` in GitHub Actions. The environment `sign-azure-artifact` permits only that branch. Each Windows runner builds its native helper, signs it, and verifies the packaged bytes. This validation workflow does not publish to npm or create a GitHub release, and its local package is discarded when the runner ends.

The workflow contains only inline commands. It downloads pinned, checksum-verified Microsoft SDK BuildTools 10.0.26100.4188, ArtifactSigning.Client 1.0.128, and .NET Runtime 8.0.34. Those tools run in CI and do not enter the npm package.

## Authentication

GitHub issues a temporary OIDC assertion for this job. The Microsoft client exchanges it using `WorkloadIdentityCredential`. Every other credential provider is excluded, so a cached runner login cannot silently replace the intended identity. The token file is removed in `finally`.

The Azure app has `Artifact Signing Certificate Profile Signer` only on the `ffi-pty` profile in account `jdalton`. GitHub stores the tenant ID, client ID, subscription ID, endpoint, account name, and profile name as environment secrets. The subscription ID is useful for administration but the signing request only needs the other five settings.

## Verification

SignTool uses SHA-256 and the Microsoft RFC 3161 timestamp service. CI requires successful Authenticode verification, the exact publisher subject from `src/win32/windows-helper-publisher.mts`, and a timestamp. It checks the executable's target architecture and compares the packed helper's SHA-256 with the signed build.

Native tests verify the production publisher, reject a different publisher and a tampered binary, and exercise helper lifecycle behavior. Ordinary unit tests have no network access and use Nock fixtures for HTTP.

## Maintenance

Identity validation expires November 11, 2027. Renew it before expiry. Leaf certificates rotate automatically, so do not pin their thumbprint. Keep publisher policy in reviewed source and check any deliberate identity change before updating it.

`Default` cannot be renamed, and Azure rejected moving `Microsoft.CodeSigning/codeSigningAccounts`. The account has a delete lock named `protect-signing-account`. Deliberate resource deletion requires removing that lock. No diagnostic log export has been configured yet.

References: [Microsoft signing integration](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations), [OIDC](https://github.com/Azure/artifact-signing-action/blob/main/docs/OIDC.md), [role assignment](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles).
