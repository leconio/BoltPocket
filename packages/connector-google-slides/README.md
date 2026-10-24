# Google Slides Connector

Project-scoped Google Slides connector. A presentation is represented as
canonical, bounded JSON containing slide text boxes and read-only table text.
The mobile adapter maps text changes back to the original shape object IDs and
uses Slides revision control, preserving unrelated layouts, images, and
formatting.

New presentations accept either the canonical JSON form or plain text split by
`---` slide separators. OAuth, HTTP, and encrypted recovery stay in the app.
