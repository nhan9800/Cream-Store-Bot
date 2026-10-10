# Admin authentication policy — 2026-10-10

The owner explicitly selected “Không dùng MFA cho Admin” after the access risk was explained. This supersedes the earlier mandatory enrollment decision for Admin accounts that have not enabled MFA.

- An unenrolled Admin may use the website with a valid signed session and the current SQLite Admin role.
- An Admin who already enabled MFA keeps MFA login and the existing expiring step-up protection. This change does not delete MFA secrets, recovery codes or revoke enrollment.
- Staff enrollment and step-up remain mandatory. Members cannot obtain staff access through a role header.
- API key, current account, blacklist, current session version, ownership and system-Admin authorization checks remain in place at the bot boundary.
- The production legacy bot dashboard remains retired. Commerce data is unchanged.
- Website role resolution must follow the API's `mfa_enabled`/`mfa_required` state; failed reads must show an error, not zero sales or bot offline.

Regression coverage: `tests/account-security.test.js` and `tests/web-api-authorization.test.js` exercise optional Admin enrollment, mandatory Staff enrollment, enrolled Admin proofs and revoked sessions. Website runtime verifies the same policy separately.
