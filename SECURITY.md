# Security policy

## Supported versions

`fastify-ep` is pre-1.0. Only the latest published minor version receives security fixes.

| Version        | Supported |
| -------------- | --------- |
| latest `0.x`   | Yes       |
| older versions | No        |

Once 1.0 ships, this table will list the supported release lines.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** (https://github.com/oluyoung/fastify-ep/security/advisories/new).

Include:

- the `fastify-ep` version and your Node.js version;
- the command you ran and the options you used;
- what you expected and what happened;
- a minimal reproduction, if you have one.

You can expect an acknowledgement within 7 days. We will keep you updated while we investigate, agree
a disclosure date with you, and credit you in the release notes unless you prefer not to be named.

## Scope

In scope:

- the `fastify-ep` CLI (`init`, `generate`, `doctor`, `upgrade`), for example path traversal, unsafe
  file overwrites, or command injection through names and options;
- insecure defaults in the code the CLI generates (the templates and presets);
- the published npm package and its release process.

Out of scope:

- vulnerabilities in projects you generated, once you have changed the code;
- vulnerabilities in third-party dependencies, which should go to those projects (tell us if a
  generated project pins a vulnerable version).

## Release integrity

Releases are published from GitHub Actions with npm provenance, so each published version can be
traced to the commit and workflow that built it.
