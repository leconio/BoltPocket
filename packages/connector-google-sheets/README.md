# Google Sheets Connector

Project-scoped Google Sheets connector. One BoltPocket resource maps to one sheet
tab and exposes its bounded cell grid as canonical RFC 4180 CSV. Writes retain
the tab and formatting while changing only cell values through the mobile API
adapter.

OAuth, HTTP, access-token leases, and encrypted recovery storage remain in the
mobile app. The package contains only URL/CSV validation and connector policy.
