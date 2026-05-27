"""Standalone job entrypoints invoked by external schedulers.

Importing ``app.models`` here is a deliberate side-effect: it pulls every
``SQLModel`` table class into the registry so SQLAlchemy can resolve
relationship targets that are referenced by string name (e.g. a popup
relationship pointing at ``"FormFields"``). The HTTP service inherits this
implicitly via the FastAPI app's import chain; job modules don't, so they
must opt in here. Without this import the first ORM query against ``Popups``
fails with ``InvalidRequestError: expression 'FormFields' failed to locate``.
"""

import app.models  # noqa: F401  (side-effect import: register all mappers)
