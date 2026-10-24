# Mini-app native capability and distribution governance

Date: 2026-08-21

BoltPocket keeps one React Native codebase and one release branch. Global and China
mainland editions select a signed distribution profile; mini-app UI, manifest
parsing, consent and runtime code remain shared.

## Manifest and visibility

`boltpocket.h5.json` schema 3 is the only format that may declare device access or
external recipients. Each `permissions` entry contains a capability ID, a
concrete user-facing purpose and the host-fixed `once` or `session` mode. When
`network` is non-empty, every permission also contains explicit `recipients`;
an empty array means local-only processing. Each recipient references a `network` entry containing a
stable ID, exact canonical HTTPS/WSS origin and purpose. Wildcards, paths,
queries, credentials, duplicate origins and undeclared recipient references are
rejected.

Schema 1 remains readable only for offline apps with an empty permission list.
Schema 2 retains its authored purposes but is offline-only. A legacy manifest
that declares permission IDs without purposes is rejected instead of receiving
a host-invented generic explanation. Manifestless pages receive an offline,
permission-free schema 3 default.

Users can inspect the same declarations before launch from the project H5 list
or H5 history, and during preview from **Permissions & data**. These surfaces
show every capability, purpose, consent scope, data recipient and network
origin. An invalid manifest remains visible but cannot be represented as safe
or opened successfully.

## Consent and lifetime

Browser Settings is only a durable upper bound. A declared capability still
passes through the repository-owned broker. The controlled host sheet names the
mini app and exact capability and discloses purpose, scope, recipients and the
effect of refusal.

- `once`: one brokered operation; the next operation asks again.
- `session`: one grant for the active task ID plus exact snapshot SHA-256.
- refusal: suppresses repeat prompts for that capability in the current
  preview; the user may explicitly reset it from **Permissions & data**.
- concurrency: requests are serialized, and duplicate session requests share
  one decision rather than creating overlapping sheets.
- invalidation: switching tasks, hiding or closing the preview, backgrounding
  the app, changing the content hash or closing the browser cancels pending
  requests and clears all grants and refusals.

The same broker covers location, camera, microphone, file selection, motion
sensors, clipboard read/write, sharing, full-screen media, autoplay, screen wake
lock, vibration, Picture in Picture, AirPlay, protected media, screen
orientation, printing and barcode detection. The operating system may still
show its own permission or picker after host consent.

On invalidation the runtime stops native location watches and media tracks,
releases wake locks, pauses audio/video, cancels vibration, exits full screen
and Picture in Picture, restores orientation and disables media control routes.
Late sheet decisions cannot grant access to a closed or changed snapshot.

## Network and regional policy

Project previews are offline by default. A mini app with `network` declarations
does not create its WebView until the user accepts the displayed recipients.
The generated CSP contains only same-origin/data/blob sources plus the exact
declared HTTPS/WSS origins; broad `https:` and `wss:` source expressions are not
used. Preview cookies and sign-in state remain isolated from the normal browser.

The global profile accepts validated, user-approved manifest origins. The China
mainland profile is `registered-only`: an origin must also exist in the signed
distribution profile. The current mainland registry is intentionally empty, so
mainland mini apps remain offline until the operator completes recipient review
and ships a new App version. No server flag can widen this policy.

## Private local scope

Project mini apps are private content created or imported by the current user
for that user's own local project. BoltPocket does not provide a mini-app catalog,
publication, sharing, search, download, monetization or distribution path to
other users. The separate Skill Market does not distribute project mini apps.
Consequently this phase does not invent publisher identity, age ratings,
reporting, blocking, moderation, takedown or Universal Link indexing for a
catalog that does not exist. Any future sharing or catalog feature must go
through a separate product, privacy and App Review change before it is enabled.

## App Store gate

Apple App Review Guideline 4.7.2 requires prior permission before exposing
native APIs to mini apps. BoltPocket keeps that external state in
`APPLE_MINI_APP_NATIVE_API_APPROVAL`. Production release checks fail until a
real Apple case ID and approval date are archived; TestFlight validation does
not satisfy this gate. Review Notes must state the private, local-only design and
ask Apple to confirm whether the catalog-oriented requirements in 4.7.1, 4.7.4
and 4.7.5 are inapplicable when no software is offered to other users. Review
details live in `docs/ios-mini-app-review-checklist.md`.

Map and push provider implementations remain the separately planned phase 3.
When implemented, regional providers stay behind the existing distribution
composition point and repository-owned interfaces; they do not require a
second long-lived source branch.
