from pydantic import BaseModel


class Paging(BaseModel):
    limit: int
    offset: int
    total: int


class ListModel[T](BaseModel):
    results: list[T]
    paging: Paging


class GetOneModel[T](BaseModel):
    result: T
