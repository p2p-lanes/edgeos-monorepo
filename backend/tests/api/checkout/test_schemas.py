from app.api.checkout.schemas import BuyerInfo


def test_buyer_info_normalizes_email_case_and_whitespace() -> None:
    buyer = BuyerInfo(
        email="  Buyer@Example.COM  ",
        first_name="Direct",
        last_name="Buyer",
    )

    assert buyer.email == "buyer@example.com"
