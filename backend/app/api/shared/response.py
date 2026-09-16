from typing import Annotated

from fastapi import Query
from pydantic import BaseModel

# Upper bound for any single paginated response. Also reused wherever a
# call site needs "the whole collection in one unpaginated read" (e.g.
# filter-then-paginate patterns) instead of duplicating the literal.
MAX_PAGE_LIMIT = 1000

PaginationSkip = Annotated[int, Query(ge=0, description="Number of items to skip")]
PaginationLimit = Annotated[
    int, Query(ge=1, le=MAX_PAGE_LIMIT, description="Maximum number of items to return")
]


class Paging(BaseModel):
    limit: int
    offset: int
    total: int


class ListModel[T](BaseModel):
    results: list[T]
    paging: Paging


class GetOneModel[T](BaseModel):
    result: T
